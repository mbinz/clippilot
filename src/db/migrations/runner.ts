import type Database from 'better-sqlite3';
import { migration001 } from './001_initial.js';
import { migration002 } from './002_stories.js';
import { migration003 } from './003_similarity.js';
import { migration004 } from './004_timecode.js';
import { migration005 } from './005_nb_frames.js';
import { migration006 } from './006_has_audio_video.js';
import { migration007 } from './007_scene_hint.js';
import { migration008 } from './008_highlights.js';
import { migration009 } from './009_calibration.js';
import { migration010 } from './010_reviewed_clips.js';
import { migration011 } from './011_slowmo.js';
import { migration012 } from './012_moment_tags.js';
import { migration013 } from './013_moment_audio.js';
import { migration014 } from './014_dup_groups.js';
import { migration015 } from './015_events.js';
import { migration016 } from './016_storyboard.js';

interface Migration {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
}

const migrations: Migration[] = [
  { version: 1, name: 'initial_schema', up: migration001 },
  { version: 2, name: 'stories', up: migration002 },
  { version: 3, name: 'similarity', up: migration003 },
  { version: 4, name: 'timecode', up: migration004 },
  { version: 5, name: 'nb_frames', up: migration005 },
  { version: 6, name: 'has_audio_video', up: migration006 },
  { version: 7, name: 'scene_hint', up: migration007 },
  { version: 8, name: 'highlights', up: migration008 },
  { version: 9, name: 'calibration', up: migration009 },
  { version: 10, name: 'reviewed_clips', up: migration010 },
  { version: 11, name: 'slowmo', up: migration011 },
  { version: 12, name: 'moment_tags', up: migration012 },
  { version: 13, name: 'moment_audio', up: migration013 },
  { version: 14, name: 'dup_groups', up: migration014 },
  { version: 15, name: 'events', up: migration015 },
  { version: 16, name: 'storyboard', up: migration016 },
];

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const applied = new Set(
    db.prepare('SELECT version FROM _migrations').all()
      .map((row: any) => row.version as number),
  );

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;

    const runInTransaction = db.transaction(() => {
      migration.up(db);
      db.prepare('INSERT INTO _migrations (version, name) VALUES (?, ?)').run(
        migration.version,
        migration.name,
      );
    });

    runInTransaction();
  }
}
