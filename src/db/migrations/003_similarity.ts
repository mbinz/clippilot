import type Database from 'better-sqlite3';

export function migration003(db: Database.Database): void {
  db.exec(`
    CREATE TABLE clip_similarity_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER REFERENCES projects(id),
      reason TEXT NOT NULL,
      computed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE clip_similarity_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL REFERENCES clip_similarity_groups(id) ON DELETE CASCADE,
      clip_id INTEGER NOT NULL REFERENCES clips(id),
      is_best INTEGER NOT NULL DEFAULT 0,
      similarity_score REAL NOT NULL DEFAULT 0
    );

    CREATE INDEX idx_sim_members_group ON clip_similarity_members(group_id);
    CREATE INDEX idx_sim_members_clip ON clip_similarity_members(clip_id);
  `);
}
