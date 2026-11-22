import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../src/db/migrations/runner.js';

type Col = { name: string; notnull: number; dflt_value: string | null };
const cols = (db: Database.Database, t: string) => db.prepare(`PRAGMA table_info(${t})`).all() as Col[];

describe('migration 016 - storyboard', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    db.prepare("INSERT INTO projects (name) VALUES ('p')").run();
    db.prepare("INSERT INTO stories (project_id, name) VALUES (1, 'Main')").run();
    db.prepare(`INSERT INTO clips (project_id, file_path, file_hash, file_size, duration_sec) VALUES (1, '/a.mp4', 'h', 1, 30)`).run();
    db.prepare("INSERT INTO scenes (story_id, position, name) VALUES (1, 0, 'S')").run();
  });

  it('adds brief columns to stories', () => {
    const c = cols(db, 'stories');
    expect(c.find((x) => x.name === 'brief')!.notnull).toBe(0);
    const state = c.find((x) => x.name === 'brief_state')!;
    expect(state.notnull).toBe(1);
    expect(state.dflt_value).toBe("'none'");
    expect(() => db.prepare("UPDATE stories SET brief_state = 'bogus'").run()).toThrow();
    db.prepare("UPDATE stories SET brief_state = 'confirmed'").run();
  });

  it('creates scenes with unique position per story and cascade from story', () => {
    expect(cols(db, 'scenes').map((c) => c.name)).toEqual(
      ['id', 'story_id', 'position', 'name', 'event_id', 'notes', 'created_at']);
    expect(() => db.prepare("INSERT INTO scenes (story_id, position, name) VALUES (1, 0, 'dup')").run()).toThrow();
    db.prepare('DELETE FROM stories WHERE id = 1').run();
    expect(db.prepare('SELECT COUNT(*) AS n FROM scenes').get()).toEqual({ n: 0 });
  });

  it('sets scene event_id to NULL when the event is deleted', () => {
    db.prepare("INSERT INTO events (project_id, name, source) VALUES (1, 'e', 'folder')").run();
    db.prepare('UPDATE scenes SET event_id = 1').run();
    db.prepare('DELETE FROM events').run();
    expect(db.prepare('SELECT event_id FROM scenes').get()).toEqual({ event_id: null });
  });

  it('reshapes story_segments into panels', () => {
    expect(cols(db, 'story_segments').map((c) => c.name)).toEqual([
      'id', 'story_id', 'scene_id', 'position', 'intent', 'state', 'source', 'clip_id', 'moment_id',
      'start_sec', 'end_sec', 'speed', 'notes', 'created_at']);
    // gap is fine without a clip
    db.prepare("INSERT INTO story_segments (story_id, scene_id, position, state) VALUES (1, 1, 0, 'gap')").run();
    const row = db.prepare('SELECT intent, source, speed FROM story_segments').get();
    expect(row).toEqual({ intent: '', source: 'ai', speed: 1 });
    // filled needs clip + in/out
    expect(() => db.prepare("INSERT INTO story_segments (story_id, scene_id, position, state) VALUES (1, 1, 1, 'filled')").run()).toThrow();
    db.prepare("INSERT INTO story_segments (story_id, scene_id, position, state, clip_id, start_sec, end_sec) VALUES (1, 1, 1, 'filled', 1, 0, 5)").run();
    // bad enums
    expect(() => db.prepare("INSERT INTO story_segments (story_id, scene_id, position, state) VALUES (1, 1, 2, 'x')").run()).toThrow();
    expect(() => db.prepare("INSERT INTO story_segments (story_id, scene_id, position, state, source) VALUES (1, 1, 2, 'gap', 'x')").run()).toThrow();
    // unique (scene, position)
    expect(() => db.prepare("INSERT INTO story_segments (story_id, scene_id, position, state) VALUES (1, 1, 1, 'gap')").run()).toThrow();
  });

  it('cascades panels from scene delete; moment_id is nulled when the moment goes', () => {
    db.prepare("INSERT INTO highlights (clip_id, start_sec, end_sec, description, tier) VALUES (1, 0, 5, 'm', 'hero')").run();
    db.prepare("INSERT INTO story_segments (story_id, scene_id, position, state, clip_id, moment_id, start_sec, end_sec) VALUES (1, 1, 0, 'filled', 1, 1, 0, 5)").run();
    db.prepare('DELETE FROM highlights').run();
    expect(db.prepare('SELECT moment_id, clip_id FROM story_segments').get()).toEqual({ moment_id: null, clip_id: 1 });
    db.prepare('DELETE FROM scenes').run();
    expect(db.prepare('SELECT COUNT(*) AS n FROM story_segments').get()).toEqual({ n: 0 });
  });

  it('creates panel_candidates cascading from panel and moment', () => {
    db.prepare("INSERT INTO highlights (clip_id, start_sec, end_sec, description, tier) VALUES (1, 0, 5, 'm', 'hero')").run();
    db.prepare("INSERT INTO highlights (clip_id, start_sec, end_sec, description, tier) VALUES (1, 6, 9, 'n', 'solid')").run();
    db.prepare("INSERT INTO story_segments (story_id, scene_id, position, state) VALUES (1, 1, 0, 'candidates')").run();
    db.prepare('INSERT INTO panel_candidates (panel_id, moment_id, position) VALUES (1, 1, 0), (1, 2, 1)').run();
    expect(() => db.prepare('INSERT INTO panel_candidates (panel_id, moment_id, position) VALUES (1, 1, 2)').run()).toThrow();
    db.prepare('DELETE FROM highlights WHERE id = 1').run();
    expect(db.prepare('SELECT COUNT(*) AS n FROM panel_candidates').get()).toEqual({ n: 1 });
    db.prepare('DELETE FROM story_segments').run();
    expect(db.prepare('SELECT COUNT(*) AS n FROM panel_candidates').get()).toEqual({ n: 0 });
  });

  it('adds highlights.status/reject_reason and clips.hidden with defaults', () => {
    db.prepare("INSERT INTO highlights (clip_id, start_sec, end_sec, description, tier) VALUES (1, 0, 5, 'm', 'hero')").run();
    expect(db.prepare('SELECT status, reject_reason FROM highlights').get()).toEqual({ status: 'proposed', reject_reason: null });
    expect(() => db.prepare("UPDATE highlights SET status = 'nope'").run()).toThrow();
    expect(db.prepare('SELECT hidden FROM clips').get()).toEqual({ hidden: 0 });
  });
});
