import type Database from 'better-sqlite3';

/**
 * F1: result of the shake fit per moment. `shake_status` null = not checked, else clean | fixed | kept; `shake_note` =
 * why a moment was kept (the AI check's reason); `shake_checked_start/_end` = the range the status is about (a changed
 * range means "not checked" again, so an unchanged range is never sent to the AI twice).
 */
export function migration025(db: Database.Database): void {
  db.exec(`
    ALTER TABLE highlights ADD COLUMN shake_status TEXT;
    ALTER TABLE highlights ADD COLUMN shake_note TEXT;
    ALTER TABLE highlights ADD COLUMN shake_checked_start REAL;
    ALTER TABLE highlights ADD COLUMN shake_checked_end REAL;
  `);
}
