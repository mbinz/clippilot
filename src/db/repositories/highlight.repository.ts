import type Database from 'better-sqlite3';
import type { Tier } from '../../core/tiers.js';

export type Shot = 'wide' | 'medium' | 'close' | 'detail';
export type AudioType = 'ambient' | 'speech' | 'music' | 'noise';
export type Role = 'establishing' | 'action' | 'reaction' | 'detail' | 'transition';

export interface HighlightRecord {
  id: number;
  clip_id: number;
  start_sec: number;
  end_sec: number;
  description: string;
  tier: Tier;
  shot: Shot | null;
  role: Role | null;
  issues: string; // JSON array
  slowmo: 'none' | 'light' | 'strong';
  slowmo_reason: string;
  suggested_speed: number;
  audio_keep: 0 | 1;
  audio_type: AudioType;
  dup_group: number | null;
  status: 'proposed' | 'confirmed' | 'rejected';
  reject_reason: string | null;
  created_at: string;
}

export interface InsertHighlight {
  start_sec: number;
  end_sec: number;
  description: string;
  tier: Tier;
  shot?: Shot | null;
  role?: Role | null;
  issues?: string[];
  slowmo?: 'none' | 'light' | 'strong';
  slowmo_reason?: string;
  suggested_speed?: number;
  audio_keep?: boolean;
  audio_type?: AudioType;
}

export class HighlightRepository {
  private stmtDelete: Database.Statement;
  private stmtInsert: Database.Statement;
  private stmtFindByClip: Database.Statement;
  private stmtListByProject: Database.Statement;
  private stmtListAll: Database.Statement;
  private stmtClearDup: Database.Statement;
  private stmtSetDup: Database.Statement;

  constructor(private db: Database.Database) {
    this.stmtDelete = db.prepare('DELETE FROM highlights WHERE clip_id = ?');
    this.stmtInsert = db.prepare(
      'INSERT INTO highlights (clip_id, start_sec, end_sec, description, tier, shot, role, issues, slowmo, slowmo_reason, suggested_speed, audio_keep, audio_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    this.stmtFindByClip = db.prepare(
      'SELECT * FROM highlights WHERE clip_id = ? ORDER BY start_sec ASC, id ASC',
    );
    this.stmtClearDup = db.prepare(
      'UPDATE highlights SET dup_group = NULL WHERE clip_id IN (SELECT id FROM clips WHERE project_id = ?)',
    );
    this.stmtSetDup = db.prepare('UPDATE highlights SET dup_group = ? WHERE id = ?');
    this.stmtListAll = db.prepare('SELECT * FROM highlights ORDER BY clip_id ASC, start_sec ASC, id ASC');
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
        this.stmtInsert.run(clipId, h.start_sec, h.end_sec, h.description, h.tier,
          h.shot ?? null, h.role ?? null, JSON.stringify(h.issues ?? []),
          h.slowmo ?? 'none', h.slowmo_reason ?? '', h.suggested_speed ?? 1,
          h.audio_keep ? 1 : 0, h.audio_type ?? 'noise');
      }
    })();
  }

  findByClip(clipId: number): HighlightRecord[] {
    return this.stmtFindByClip.all(clipId) as HighlightRecord[];
  }

  listByProject(projectId: number): HighlightRecord[] {
    return this.stmtListByProject.all(projectId) as HighlightRecord[];
  }

  listAll(): HighlightRecord[] {
    return this.stmtListAll.all() as HighlightRecord[];
  }

  /** Replace the project's duplicate-group numbers (clears them first). */
  setDupGroups(projectId: number, groups: Map<number, number>): void {
    this.db.transaction(() => {
      this.stmtClearDup.run(projectId);
      for (const [id, group] of groups) this.stmtSetDup.run(group, id);
    })();
  }
}
