import type Database from 'better-sqlite3';

export function migration008(db: Database.Database): void {
  db.exec(`
    CREATE TABLE highlights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      clip_id INTEGER NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
      start_sec REAL NOT NULL,
      end_sec REAL NOT NULL,
      description TEXT NOT NULL,
      quality INTEGER NOT NULL CHECK (quality BETWEEN 1 AND 10),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_highlights_clip_id ON highlights(clip_id);
  `);
}
