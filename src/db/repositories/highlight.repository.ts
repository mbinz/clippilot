import type Database from 'better-sqlite3';

export interface HighlightRecord {
  id: number;
  clip_id: number;
  start_sec: number;
  end_sec: number;
  description: string;
  quality: number;
  created_at: string;
}

export interface InsertHighlight {
  start_sec: number;
  end_sec: number;
  description: string;
  quality: number;
}

export class HighlightRepository {
  private stmtDelete: Database.Statement;
  private stmtInsert: Database.Statement;
  private stmtFindByClip: Database.Statement;
  private stmtListByProject: Database.Statement;

  constructor(private db: Database.Database) {
    this.stmtDelete = db.prepare('DELETE FROM highlights WHERE clip_id = ?');
    this.stmtInsert = db.prepare(
      'INSERT INTO highlights (clip_id, start_sec, end_sec, description, quality) VALUES (?, ?, ?, ?, ?)',
    );
    this.stmtFindByClip = db.prepare(
      'SELECT * FROM highlights WHERE clip_id = ? ORDER BY start_sec ASC, id ASC',
    );
    this.stmtListByProject = db.prepare(`
      SELECT h.* FROM highlights h
      JOIN clips c ON c.id = h.clip_id
      WHERE c.project_id = ?
      ORDER BY h.clip_id ASC, h.start_sec ASC, h.id ASC
    `);
  }

  replaceForClip(clipId: number, items: InsertHighlight[]): void {
    this.db.transaction(() => {
      this.stmtDelete.run(clipId);
      for (const h of items) {
        this.stmtInsert.run(clipId, h.start_sec, h.end_sec, h.description, h.quality);
      }
    })();
  }

  findByClip(clipId: number): HighlightRecord[] {
    return this.stmtFindByClip.all(clipId) as HighlightRecord[];
  }

  listByProject(projectId: number): HighlightRecord[] {
    return this.stmtListByProject.all(projectId) as HighlightRecord[];
  }
}
