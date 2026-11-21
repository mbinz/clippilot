import type Database from 'better-sqlite3';

/** Moments carry an audio tag: keep the original sound, and what mainly can be heard. */
export function migration013(db: Database.Database): void {
  db.exec(`
    ALTER TABLE highlights ADD COLUMN audio_keep INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE highlights ADD COLUMN audio_type TEXT NOT NULL DEFAULT 'noise';
  `);
}
