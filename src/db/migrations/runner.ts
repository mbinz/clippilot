import type Database from 'better-sqlite3';
import { migration001 } from './001_initial.js';
import { migration002 } from './002_stories.js';
import { migration003 } from './003_similarity.js';
import { migration004 } from './004_timecode.js';
import { migration005 } from './005_nb_frames.js';
import { migration006 } from './006_has_audio_video.js';

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
