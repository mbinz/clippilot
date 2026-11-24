import type Database from 'better-sqlite3';

/**
 * Keep the transcript as whisper + the per-segment filter produced it (`raw_*`), next to the effective one
 * (`segments_json`/`words_json`) that the project-level cross-clip filter may thin out. A later run recomputes the
 * effective transcript from the raw one. A new migration (not an edit of 019) because 019 is already applied to real databases.
 */
export function migration020(db: Database.Database): void {
  db.exec(`
    ALTER TABLE transcripts ADD COLUMN raw_segments_json TEXT;
    ALTER TABLE transcripts ADD COLUMN raw_words_json TEXT;
    UPDATE transcripts SET raw_segments_json = segments_json, raw_words_json = words_json;
  `);
}
