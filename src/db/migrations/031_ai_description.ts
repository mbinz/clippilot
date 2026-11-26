import type Database from 'better-sqlite3';

/** BE5: `ai_description` = the description before the first edit on the board / CLI (NULL = never edited), so undo can restore it. */
export function migration031(db: Database.Database): void {
  db.exec('ALTER TABLE highlights ADD COLUMN ai_description TEXT');
}
