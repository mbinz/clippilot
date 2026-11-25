import type Database from 'better-sqlite3';

/**
 * Per-clip motion curve (centre shift per frame pair as Int8 blobs, frame change as Float32) and the shakes found on it.
 * Moment jitter / camera motion / frame change are derived from the curve for any range, so trims need no new decode.
 */
export function migration023(db: Database.Database): void {
  db.exec(`
    CREATE TABLE motion_curves (
      clip_id INTEGER PRIMARY KEY REFERENCES clips(id) ON DELETE CASCADE,
      fps REAL NOT NULL,
      frames INTEGER NOT NULL,
      width INTEGER NOT NULL,
      src_width INTEGER NOT NULL,
      dx BLOB NOT NULL,
      dy BLOB NOT NULL,
      change BLOB NOT NULL,
      median_residual REAL NOT NULL,
      continuous INTEGER NOT NULL DEFAULT 0,
      measured_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE shakes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      clip_id INTEGER NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
      start_sec REAL NOT NULL,
      end_sec REAL NOT NULL,
      peak_sec REAL NOT NULL,
      peak REAL NOT NULL,
      jump_pct REAL NOT NULL,
      jump_px REAL NOT NULL,
      disagreement REAL NOT NULL,
      moving_scene INTEGER NOT NULL DEFAULT 0,
      confidence TEXT NOT NULL CHECK (confidence IN ('high', 'low'))
    );
    CREATE INDEX idx_shakes_clip ON shakes(clip_id);
  `);
}
