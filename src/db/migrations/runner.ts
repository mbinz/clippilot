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
import { migration017 } from './017_operations.js';
import { migration018 } from './018_moment_edit.js';
import { migration019 } from './019_transcripts.js';
import { migration020 } from './020_transcript_raw.js';
import { migration021 } from './021_motion.js';
import { migration022 } from './022_jitter.js';
import { migration023 } from './023_motion_curves.js';
import { migration024 } from './024_split_ai_speed.js';
import { migration025 } from './025_shake_fit.js';
import { migration026 } from './026_ai_speed_backfill.js';
import { migration027 } from './027_jolt_at_key_action.js';

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
  { version: 17, name: 'operations', up: migration017 },
  { version: 18, name: 'moment_edit', up: migration018 },
  { version: 19, name: 'transcripts', up: migration019 },
  { version: 20, name: 'transcript_raw', up: migration020 },
  { version: 21, name: 'motion', up: migration021 },
  { version: 22, name: 'jitter', up: migration022 },
  { version: 23, name: 'motion_curves', up: migration023 },
  { version: 24, name: 'split_ai_speed', up: migration024 },
  { version: 25, name: 'shake_fit', up: migration025 },
  { version: 26, name: 'ai_speed_backfill', up: migration026 },
  { version: 27, name: 'jolt_at_key_action', up: migration027 },
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
