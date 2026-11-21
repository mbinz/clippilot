import type Database from 'better-sqlite3';

/** Moments that show the same thing (multi-cam / near-duplicate takes) share a dup_group number per project. */
export function migration014(db: Database.Database): void {
  db.exec(`
    ALTER TABLE highlights ADD COLUMN dup_group INTEGER;
    CREATE INDEX idx_highlights_dup_group ON highlights(dup_group);
  `);
}
