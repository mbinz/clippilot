import type Database from 'better-sqlite3';

/**
 * D1: `split_of` = the moment this one was cut out of (a shake cut out of a good moment leaves a sibling after it);
 * `ai_speed` = a speed the AI set itself (review loop / draft `--ai`), so it does not count as the user's speed edit.
 */
export function migration024(db: Database.Database): void {
  db.exec(`
    ALTER TABLE highlights ADD COLUMN split_of INTEGER REFERENCES highlights(id) ON DELETE SET NULL;
    ALTER TABLE highlights ADD COLUMN ai_speed REAL;
  `);
}
