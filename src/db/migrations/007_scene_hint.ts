import type Database from 'better-sqlite3';

export function migration007(db: Database.Database): void {
  db.exec(`ALTER TABLE clips ADD COLUMN scene_hint TEXT`);
}
