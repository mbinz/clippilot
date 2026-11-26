import type Database from 'better-sqlite3';

/** BE4: `created_by` = who made a moment by hand (`user`: the board's "New moment", `ai`: `moment add --ai`); null = the analysis made it. */
export function migration030(db: Database.Database): void {
  db.exec("ALTER TABLE highlights ADD COLUMN created_by TEXT CHECK (created_by IN ('user','ai'))");
}
