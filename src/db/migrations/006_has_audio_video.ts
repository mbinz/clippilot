import type Database from 'better-sqlite3';

export function migration006(db: Database.Database): void {
  db.exec(`ALTER TABLE clips ADD COLUMN has_video INTEGER NOT NULL DEFAULT 1`);
  db.exec(`ALTER TABLE clips ADD COLUMN has_audio INTEGER NOT NULL DEFAULT 1`);
}
