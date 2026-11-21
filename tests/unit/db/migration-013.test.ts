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
import { migration012 } from '../../../src/db/migrations/012_moment_tags.js';

const cols = (db: Database.Database, table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

describe('migration 013 - moment audio', () => {
  it('adds audio_keep and audio_type to highlights', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    expect(cols(db, 'highlights')).toEqual(expect.arrayContaining(['audio_keep', 'audio_type']));
  });

  it('defaults old rows to audio_keep=0, audio_type=noise', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`CREATE TABLE _migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`);
    [migration001, migration002, migration003, migration004, migration005, migration006,
      migration007, migration008, migration009, migration010, migration011, migration012].forEach((m, i) => {
      m(db);
      db.prepare('INSERT INTO _migrations (version, name) VALUES (?, ?)').run(i + 1, `m${i + 1}`);
    });
    db.prepare("INSERT INTO clips (file_path, file_hash, file_size, duration_sec) VALUES ('a.mp4','h',1,10)").run();
    db.prepare("INSERT INTO highlights (clip_id, start_sec, end_sec, description) VALUES (1,0,2,'x')").run();
    runMigrations(db);
    expect(db.prepare('SELECT audio_keep, audio_type FROM highlights').get()).toEqual({ audio_keep: 0, audio_type: 'noise' });
  });
});
