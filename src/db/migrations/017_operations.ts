import type Database from 'better-sqlite3';

/** Operation log for server-side undo/redo of storyboard edits (before/after snapshots per cut). */
export function migration017(db: Database.Database): void {
  db.exec(`
    CREATE TABLE operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      "before" TEXT NOT NULL,
      "after" TEXT NOT NULL,
      undone INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_operations_story ON operations(story_id, id);
  `);
}
