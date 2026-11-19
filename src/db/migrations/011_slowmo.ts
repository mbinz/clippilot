import type Database from 'better-sqlite3';

export function migration011(db: Database.Database): void {
  db.exec(`
    ALTER TABLE highlights ADD COLUMN slowmo TEXT NOT NULL DEFAULT 'none';
    ALTER TABLE highlights ADD COLUMN slowmo_reason TEXT NOT NULL DEFAULT '';
    ALTER TABLE highlights ADD COLUMN suggested_speed REAL NOT NULL DEFAULT 1;
    ALTER TABLE highlight_verdicts ADD COLUMN suggested_speed REAL;
  `);
}
