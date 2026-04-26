import type Database from 'better-sqlite3';

export function migration004(db: Database.Database): void {
  db.exec(`ALTER TABLE clips ADD COLUMN start_timecode TEXT`);
}
