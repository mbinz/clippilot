import type Database from 'better-sqlite3';

export function migration010(db: Database.Database): void {
  db.exec(`
    CREATE TABLE calibration_reviewed_clips (
      round_id INTEGER NOT NULL REFERENCES calibration_rounds(id) ON DELETE CASCADE,
      clip_id INTEGER NOT NULL,
      PRIMARY KEY (round_id, clip_id)
    );
  `);
}
