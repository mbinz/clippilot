import type Database from 'better-sqlite3';

/**
 * Motion measured per moment (shake + stillness). `motion_start_sec`/`motion_end_sec` are the range that was
 * measured: a moment whose current range differs (trimmed) counts as stale and is measured again.
 */
export function migration021(db: Database.Database): void {
  db.exec(`
    ALTER TABLE highlights ADD COLUMN shake_score REAL;
    ALTER TABLE highlights ADD COLUMN shake_max_px REAL;
    ALTER TABLE highlights ADD COLUMN camera_motion REAL;
    ALTER TABLE highlights ADD COLUMN frame_change REAL;
    ALTER TABLE highlights ADD COLUMN motion_start_sec REAL;
    ALTER TABLE highlights ADD COLUMN motion_end_sec REAL;
  `);
}
