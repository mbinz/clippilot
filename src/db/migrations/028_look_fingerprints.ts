import type Database from 'better-sqlite3';

/**
 * SM1: a moment's look fingerprint = normalized Float32 average of image embeddings of 3 frames. `look_start_sec` /
 * `look_end_sec` are the range it was computed for (stale check), `look_model` the embedding model.
 */
export function migration028(db: Database.Database): void {
  db.exec('ALTER TABLE highlights ADD COLUMN look_vec BLOB');
  db.exec('ALTER TABLE highlights ADD COLUMN look_model TEXT');
  db.exec('ALTER TABLE highlights ADD COLUMN look_start_sec REAL');
  db.exec('ALTER TABLE highlights ADD COLUMN look_end_sec REAL');
}
