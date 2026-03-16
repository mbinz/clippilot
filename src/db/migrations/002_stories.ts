import type Database from 'better-sqlite3';

export function migration002(db: Database.Database): void {
  db.exec(`
    CREATE TABLE stories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER REFERENCES projects(id),
      name TEXT NOT NULL,
      description TEXT,
      target_duration_sec INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE story_segments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      clip_id INTEGER NOT NULL REFERENCES clips(id),
      position INTEGER NOT NULL,
      start_sec REAL NOT NULL DEFAULT 0,
      end_sec REAL,
      segment_role TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(story_id, position)
    );

    CREATE INDEX idx_story_segments_story ON story_segments(story_id);
  `);
}
