import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../src/db/migrations/runner.js';
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

const cols = (db: Database.Database, table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

describe('migration 012 — moment tags, no clip scores', () => {
  it('drops clip score columns and adds moment tag columns', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const clipCols = cols(db, 'clips');
    for (const c of clipCols) {
      expect(c).not.toMatch(/^ai_quality_|^ai_editorial_/);
    }
    expect(clipCols).toContain('ai_summary');
    expect(clipCols).toContain('ai_visual_keywords');

    const hl = cols(db, 'highlights');
    expect(hl).not.toContain('quality');
    expect(hl).toEqual(expect.arrayContaining(['tier', 'shot', 'role', 'issues', 'slowmo', 'suggested_speed']));

    const hv = cols(db, 'highlight_verdicts');
    expect(hv).toEqual(expect.arrayContaining(['quality', 'tier', 'shot', 'role', 'suggested_speed']));
  });

  it('highlights default tier=solid, issues=[] and CHECK rejects unknown tier', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    db.prepare("INSERT INTO clips (file_path, file_hash, file_size, duration_sec) VALUES ('a.mp4','h',1,10)").run();
    db.prepare("INSERT INTO highlights (clip_id, start_sec, end_sec, description) VALUES (1,0,2,'x')").run();
    const row = db.prepare('SELECT tier, shot, role, issues FROM highlights').get() as any;
    expect(row).toEqual({ tier: 'solid', shot: null, role: null, issues: '[]' });
    expect(() =>
      db.prepare("INSERT INTO highlights (clip_id, start_sec, end_sec, description, tier) VALUES (1,0,2,'x','epic')").run(),
    ).toThrow();
  });

  it('keeps FTS search working after migrating a DB that had data and keeps triggers in sync', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`CREATE TABLE _migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`);
    [migration001, migration002, migration003, migration004, migration005, migration006,
      migration007, migration008, migration009, migration010, migration011].forEach((m, i) => {
      m(db);
      db.prepare('INSERT INTO _migrations (version, name) VALUES (?, ?)').run(i + 1, `m${i + 1}`);
    });
    db.prepare(`INSERT INTO clips (file_path, file_hash, file_size, duration_sec, ai_summary, ai_visual_keywords,
      ai_quality_overall, ai_editorial_suggested_use) VALUES ('a.mp4','h1',1,10,'Wellen am Strand','meer, sand',3.5,'Broll')`).run();
    db.prepare(`INSERT INTO clips (file_path, file_hash, file_size, duration_sec, ai_summary, ai_visual_keywords)
      VALUES ('b.mp4','h2',1,10,'Altstadt Gasse','haus, tür')`).run();

    runMigrations(db);

    const find = (q: string) =>
      (db.prepare('SELECT rowid FROM clips_fts WHERE clips_fts MATCH ?').all(q) as { rowid: number }[]).map((r) => r.rowid);
    expect(find('Wellen')).toEqual([1]);
    expect(find('Altstadt')).toEqual([2]);
    expect(find('Broll')).toEqual([]);

    // triggers still maintain the index
    db.prepare("UPDATE clips SET ai_summary = 'Sonnenuntergang' WHERE id = 1").run();
    expect(find('Wellen')).toEqual([]);
    expect(find('Sonnenuntergang')).toEqual([1]);
    db.prepare('DELETE FROM clips WHERE id = 2').run();
    expect(find('Altstadt')).toEqual([]);
    db.prepare("INSERT INTO clips (file_path, file_hash, file_size, duration_sec, ai_summary) VALUES ('c.mp4','h3',1,1,'Delfine')").run();
    expect(find('Delfine')).toEqual([3]);
  });

  it('migrates existing highlights rows to tier solid', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`CREATE TABLE _migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`);
    [migration001, migration002, migration003, migration004, migration005, migration006,
      migration007, migration008, migration009, migration010, migration011].forEach((m, i) => {
      m(db);
      db.prepare('INSERT INTO _migrations (version, name) VALUES (?, ?)').run(i + 1, `m${i + 1}`);
    });
    db.prepare("INSERT INTO clips (file_path, file_hash, file_size, duration_sec) VALUES ('a.mp4','h',1,10)").run();
    db.prepare("INSERT INTO highlights (clip_id, start_sec, end_sec, description, quality) VALUES (1,0,2,'x',8)").run();
    runMigrations(db);
    expect(db.prepare('SELECT tier, issues FROM highlights').get()).toEqual({ tier: 'solid', issues: '[]' });
  });

  it('keeps old highlight_verdicts rows and their quality snapshot, quality is now nullable', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`CREATE TABLE _migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`);
    [migration001, migration002, migration003, migration004, migration005, migration006,
      migration007, migration008, migration009, migration010, migration011].forEach((m, i) => {
      m(db);
      db.prepare('INSERT INTO _migrations (version, name) VALUES (?, ?)').run(i + 1, `m${i + 1}`);
    });
    db.prepare('INSERT INTO calibration_rounds (profile_version) VALUES (1)').run();
    db.prepare("INSERT INTO highlight_verdicts (round_id, highlight_id, clip_id, verdicts, start_sec, end_sec, description, quality, suggested_speed) VALUES (1,5,2,'[\"bad\"]',0,1,'d',8,0.5)").run();
    runMigrations(db);
    expect(db.prepare('SELECT quality, suggested_speed, tier FROM highlight_verdicts').get()).toEqual({ quality: 8, suggested_speed: 0.5, tier: null });
    db.prepare("INSERT INTO highlight_verdicts (round_id, highlight_id, clip_id, verdicts, start_sec, end_sec, description, tier, shot, role) VALUES (1,6,2,'[]',0,1,'d','hero','wide','action')").run();
    expect(db.prepare('SELECT quality, tier FROM highlight_verdicts WHERE highlight_id = 6').get()).toEqual({ quality: null, tier: 'hero' });
  });
});
