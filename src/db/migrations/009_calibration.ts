import type Database from 'better-sqlite3';

export function migration009(db: Database.Database): void {
  db.exec(`
    CREATE TABLE calibration_rounds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      profile_version INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE highlight_verdicts (
      round_id INTEGER NOT NULL REFERENCES calibration_rounds(id) ON DELETE CASCADE,
      highlight_id INTEGER NOT NULL,
      clip_id INTEGER NOT NULL,
      verdicts TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      start_sec REAL NOT NULL,
      end_sec REAL NOT NULL,
      description TEXT NOT NULL,
      quality INTEGER NOT NULL,
      PRIMARY KEY (round_id, highlight_id)
    );
    CREATE TABLE missed_moments (
      round_id INTEGER NOT NULL REFERENCES calibration_rounds(id) ON DELETE CASCADE,
      clip_id INTEGER NOT NULL,
      at_sec REAL NOT NULL,
      note TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE clip_score_verdicts (
      round_id INTEGER NOT NULL REFERENCES calibration_rounds(id) ON DELETE CASCADE,
      clip_id INTEGER NOT NULL,
      score TEXT NOT NULL,
      verdict TEXT NOT NULL CHECK (verdict IN ('low', 'ok', 'high')),
      PRIMARY KEY (round_id, clip_id, score)
    );
    CREATE TABLE clip_notes (
      round_id INTEGER NOT NULL REFERENCES calibration_rounds(id) ON DELETE CASCADE,
      clip_id INTEGER NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      suggested_use_wrong INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (round_id, clip_id)
    );
    ALTER TABLE clips ADD COLUMN analysis_profile_version INTEGER;
  `);
}
