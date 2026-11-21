import type Database from 'better-sqlite3';

/** Events group clips by where/when they were shot (a folder, or a run of recordings close in time). */
export function migration015(db: Database.Database): void {
  db.exec(`
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id),
      name TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('folder', 'time')),
      folder_path TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_events_project ON events(project_id);
    ALTER TABLE clips ADD COLUMN event_id INTEGER REFERENCES events(id) ON DELETE SET NULL;
    CREATE INDEX idx_clips_event ON clips(event_id);
  `);
}
