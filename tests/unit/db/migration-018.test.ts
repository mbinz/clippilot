import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { migration001 } from '../../../src/db/migrations/001_initial.js';
import { migration002 } from '../../../src/db/migrations/002_stories.js';
import { migration003 } from '../../../src/db/migrations/003_similarity.js';
import { migration004 } from '../../../src/db/migrations/004_timecode.js';
import { migration005 } from '../../../src/db/migrations/005_nb_frames.js';
import { migration006 } from '../../../src/db/migrations/006_has_audio_video.js';
import { migration007 } from '../../../src/db/migrations/007_scene_hint.js';
import { migration008 } from '../../../src/db/migrations/008_highlights.js';
import { migration009 } from '../../../src/db/migrations/009_calibration.js';
import { migration010 } from '../../../src/db/migrations/010_reviewed_clips.js';
import { migration011 } from '../../../src/db/migrations/011_slowmo.js';
import { migration012 } from '../../../src/db/migrations/012_moment_tags.js';
import { migration013 } from '../../../src/db/migrations/013_moment_audio.js';
import { migration014 } from '../../../src/db/migrations/014_dup_groups.js';
import { migration015 } from '../../../src/db/migrations/015_events.js';
import { migration016 } from '../../../src/db/migrations/016_storyboard.js';
import { migration017 } from '../../../src/db/migrations/017_operations.js';
import { migration018 } from '../../../src/db/migrations/018_moment_edit.js';
import { migration023 } from '../../../src/db/migrations/023_motion_curves.js';
import { migration019 } from '../../../src/db/migrations/019_transcripts.js';
import { runMigrations } from '../../../src/db/migrations/runner.js';
import { StoryboardService } from '../../../src/core/storyboard/service.js';
import { cutToSegments } from '../../../src/core/storyboard/export.js';

/** A database at schema version 17 (panels carry their own range and speed) with a small cut. */
function preDb(opts: { sharedMoment?: boolean } = {}) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  [migration001, migration002, migration003, migration004, migration005, migration006, migration007, migration008,
    migration009, migration010, migration011, migration012, migration013, migration014, migration015, migration016,
    migration017].forEach((m) => m(db));
  db.prepare("INSERT INTO projects (name) VALUES ('p')").run();
  db.prepare("INSERT INTO stories (project_id, name) VALUES (1, 'Main')").run();
  const clip = db.prepare('INSERT INTO clips (project_id, file_path, file_hash, file_size, duration_sec, fps) VALUES (1, ?, ?, 1, 30, ?)');
  clip.run('/a.mp4', 'a', 25); // 1
  clip.run('/b.mp4', 'b', 50); // 2
  const mom = db.prepare('INSERT INTO highlights (clip_id, start_sec, end_sec, description, tier, suggested_speed) VALUES (?, ?, ?, ?, ?, ?)');
  mom.run(1, 2, 8, 'm1', 'solid', 0.5);   // 1: 25 fps -> default speed 1
  mom.run(2, 0, 10, 'm2', 'hero', 0.5);   // 2: 50 fps -> default speed 0.5
  mom.run(1, 12, 16, 'm3', 'solid', 1);   // 3
  db.prepare("INSERT INTO scenes (story_id, position, name) VALUES (1, 0, 'S1')").run();
  db.prepare("INSERT INTO scenes (story_id, position, name) VALUES (1, 1, 'S2')").run();
  const panel = db.prepare(`INSERT INTO story_segments (story_id, scene_id, position, intent, state, source, clip_id, moment_id, start_sec, end_sec, speed)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  panel.run(1, 0, 'a', 'filled', 'user', 1, 1, 3, 7, 1);       // 1
  panel.run(1, 1, 'b', 'filled', 'ai', 2, 2, 4, 6, 0.5);       // 2
  panel.run(1, 2, 'c', 'candidates', 'ai', null, null, null, null, 1); // 3
  panel.run(2, 0, 'd', 'gap', 'ai', null, null, null, null, 1);        // 4
  if (opts.sharedMoment) panel.run(2, 1, 'e', 'filled', 'ai', 1, 1, 10, 12, 1); // 5: same moment as panel 1
  db.prepare('INSERT INTO panel_candidates (panel_id, moment_id, position) VALUES (3, 3, 0)').run();
  db.prepare('INSERT INTO panel_candidates (panel_id, moment_id, position) VALUES (3, 1, 1)').run();
  db.prepare(`INSERT INTO operations (story_id, label, "before", "after") VALUES (1, 'old', '{}', '{}')`).run();
  return db;
}

const cols = (db: Database.Database, t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);

describe('migration 018 - the moment is the edit', () => {
  it('adds moment columns and backfills the ai range (an AI panel range replaces it)', () => {
    const db = preDb();
    migration018(db);
    expect(cols(db, 'highlights')).toEqual(expect.arrayContaining(['speed', 'ai_start_sec', 'ai_end_sec', 'user_tier', 'seen_at']));
    const rows = db.prepare('SELECT id, ai_start_sec, ai_end_sec, user_tier, seen_at FROM highlights ORDER BY id').all();
    expect(rows).toEqual([
      { id: 1, ai_start_sec: 2, ai_end_sec: 8, user_tier: null, seen_at: null },
      { id: 2, ai_start_sec: 4, ai_end_sec: 6, user_tier: null, seen_at: null }, // AI panel's range = AI choice
      { id: 3, ai_start_sec: 12, ai_end_sec: 16, user_tier: null, seen_at: null },
    ]);
  });

  it('copies each filled panel range and speed into its moment; a user panel keeps the ai range, an ai panel adopts it', () => {
    const db = preDb();
    migration018(db);
    const m = db.prepare('SELECT id, start_sec, end_sec, speed, ai_start_sec, ai_end_sec FROM highlights ORDER BY id').all();
    expect(m).toEqual([
      { id: 1, start_sec: 3, end_sec: 7, speed: 1, ai_start_sec: 2, ai_end_sec: 8 },
      { id: 2, start_sec: 4, end_sec: 6, speed: 0.5, ai_start_sec: 4, ai_end_sec: 6 },
      { id: 3, start_sec: 12, end_sec: 16, speed: 1, ai_start_sec: 12, ai_end_sec: 16 },
    ]);
  });

  it('an AI panel range is the AI choice (not "changed by you"); a user panel range stays an edit', () => {
    const db = preDb();
    migration018(db);
    const r = (id: number) => db.prepare('SELECT start_sec, end_sec, ai_start_sec, ai_end_sec, speed FROM highlights WHERE id = ?').get(id);
    expect(r(2)).toEqual({ start_sec: 4, end_sec: 6, ai_start_sec: 4, ai_end_sec: 6, speed: 0.5 });
    expect(r(1)).toEqual({ start_sec: 3, end_sec: 7, ai_start_sec: 2, ai_end_sec: 8, speed: 1 });
  });

  it('uses the fps-gated suggested speed for moments no panel overrides', () => {
    const db = preDb();
    db.prepare('DELETE FROM story_segments').run();
    migration018(db);
    expect(db.prepare('SELECT id, speed FROM highlights ORDER BY id').all()).toEqual([
      { id: 1, speed: 1 }, { id: 2, speed: 0.5 }, { id: 3, speed: 1 },
    ]);
  });

  it('the first panel (cut, scene, position) wins when a moment is used twice', () => {
    const db = preDb({ sharedMoment: true });
    migration018(db);
    expect(db.prepare('SELECT start_sec, end_sec FROM highlights WHERE id = 1').get()).toEqual({ start_sec: 3, end_sec: 7 });
  });

  it('rebuilds story_segments without range/speed, keeps panels, candidates and the filled check', () => {
    const db = preDb();
    migration018(db);
    expect(cols(db, 'story_segments')).toEqual([
      'id', 'story_id', 'scene_id', 'position', 'intent', 'state', 'source', 'clip_id', 'moment_id', 'notes', 'created_at']);
    expect(db.prepare('SELECT id, scene_id, position, intent, state, source, clip_id, moment_id FROM story_segments ORDER BY id').all()).toEqual([
      { id: 1, scene_id: 1, position: 0, intent: 'a', state: 'filled', source: 'user', clip_id: 1, moment_id: 1 },
      { id: 2, scene_id: 1, position: 1, intent: 'b', state: 'filled', source: 'ai', clip_id: 2, moment_id: 2 },
      { id: 3, scene_id: 1, position: 2, intent: 'c', state: 'candidates', source: 'ai', clip_id: null, moment_id: null },
      { id: 4, scene_id: 2, position: 0, intent: 'd', state: 'gap', source: 'ai', clip_id: null, moment_id: null },
    ]);
    expect(db.prepare('SELECT panel_id, moment_id, position FROM panel_candidates ORDER BY position').all())
      .toEqual([{ panel_id: 3, moment_id: 3, position: 0 }, { panel_id: 3, moment_id: 1, position: 1 }]);
    // filled needs a clip and a moment; gaps don't
    expect(() => db.prepare("INSERT INTO story_segments (story_id, scene_id, position, state, clip_id) VALUES (1, 2, 5, 'filled', 1)").run()).toThrow();
    db.prepare("INSERT INTO story_segments (story_id, scene_id, position, state, clip_id, moment_id) VALUES (1, 2, 5, 'filled', 1, 1)").run();
    // unique (scene, position) and the cascade to candidates survive the rebuild
    expect(() => db.prepare("INSERT INTO story_segments (story_id, scene_id, position, state) VALUES (1, 2, 5, 'gap')").run()).toThrow();
    db.prepare('DELETE FROM story_segments WHERE id = 3').run();
    expect(db.prepare('SELECT COUNT(*) AS n FROM panel_candidates').get()).toEqual({ n: 0 });
  });

  it('keeps cut totals and the exported segments unchanged', () => {
    const db = preDb();
    const before = db.prepare("SELECT clip_id, start_sec, end_sec, speed FROM story_segments WHERE state = 'filled' ORDER BY scene_id, position").all();
    const secs = (before as { start_sec: number; end_sec: number; speed: number }[]).reduce((s, p) => s + (p.end_sec - p.start_sec) / p.speed, 0);
    migration018(db);
    migration019(db); // getCut reads transcripts
    migration023(db); // ... and the motion curves
    const tree = new StoryboardService(db).getCut(1)!;
    expect(tree.totals).toMatchObject({ panels: 4, filled: 2, candidates: 1, gaps: 1, duration_sec: secs });
    const segs = cutToSegments(db, 1).segments.slice(0, 2).map((s) => ({ clip_id: s.clip_id, start_sec: s.start_sec, end_sec: s.end_sec, speed: s.speed }));
    expect(segs).toEqual(before);
  });

  it('keeps a filled panel whose moment link was lost by giving it a moment of its own', () => {
    const db = preDb();
    db.prepare('UPDATE story_segments SET moment_id = NULL WHERE id = 1').run();
    migration018(db);
    const p = db.prepare('SELECT moment_id FROM story_segments WHERE id = 1').get() as { moment_id: number };
    expect(p.moment_id).not.toBeNull();
    expect(db.prepare('SELECT clip_id, start_sec, end_sec, speed FROM highlights WHERE id = ?').get(p.moment_id))
      .toEqual({ clip_id: 1, start_sec: 3, end_sec: 7, speed: 1 });
  });

  it('clears the old undo log (its snapshots hold panel ranges)', () => {
    const db = preDb();
    migration018(db);
    expect(db.prepare('SELECT COUNT(*) AS n FROM operations').get()).toEqual({ n: 0 });
  });

  it('user_tier only accepts hero / solid / filler; new moments get their ai range', () => {
    const db = preDb();
    migration018(db);
    db.prepare("UPDATE highlights SET user_tier = 'hero' WHERE id = 1").run();
    expect(() => db.prepare("UPDATE highlights SET user_tier = 'best' WHERE id = 1").run()).toThrow();
    const id = Number(db.prepare("INSERT INTO highlights (clip_id, start_sec, end_sec, description, tier) VALUES (1, 20, 25, 'new', 'solid')").run().lastInsertRowid);
    expect(db.prepare('SELECT ai_start_sec, ai_end_sec, speed FROM highlights WHERE id = ?').get(id)).toEqual({ ai_start_sec: 20, ai_end_sec: 25, speed: 1 });
  });

  it('runs through the normal migration runner on a fresh database', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    expect(db.prepare('SELECT MAX(version) AS v FROM _migrations').get()).toEqual({ v: 28 });
  });
});
