import type Database from 'better-sqlite3';

export interface ThumbnailRecord {
  id: number;
  clip_id: number;
  file_path: string;
  timestamp_sec: number;
}

export interface InsertThumbnail {
  clip_id: number;
  file_path: string;
  timestamp_sec: number;
}

export class ThumbnailRepository {
  private stmtInsert: Database.Statement;
  private stmtFindByClip: Database.Statement;

  constructor(private db: Database.Database) {
    this.stmtInsert = db.prepare(
      'INSERT INTO thumbnails (clip_id, file_path, timestamp_sec) VALUES (?, ?, ?)',
    );
    this.stmtFindByClip = db.prepare(
      'SELECT * FROM thumbnails WHERE clip_id = ? ORDER BY timestamp_sec ASC',
    );
  }

  insert(thumbnail: InsertThumbnail): ThumbnailRecord {
    const result = this.stmtInsert.run(thumbnail.clip_id, thumbnail.file_path, thumbnail.timestamp_sec);
    return {
      id: result.lastInsertRowid as number,
      ...thumbnail,
    };
  }

  insertMany(thumbnails: InsertThumbnail[]): void {
    const insertMany = this.db.transaction((items: InsertThumbnail[]) => {
      for (const t of items) {
        this.stmtInsert.run(t.clip_id, t.file_path, t.timestamp_sec);
      }
    });
    insertMany(thumbnails);
  }

  findByClip(clipId: number): ThumbnailRecord[] {
    return this.stmtFindByClip.all(clipId) as ThumbnailRecord[];
  }
}
