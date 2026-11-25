import type Database from 'better-sqlite3';

/**
 * A2: the analysis flags a moment whose key action happens during a measured camera jolt. The shake fit then keeps
 * the moment as it is (no AI check, no trim).
 */
export function migration027(db: Database.Database): void {
  db.exec('ALTER TABLE highlights ADD COLUMN jolt_at_key_action INTEGER DEFAULT 0');
}
