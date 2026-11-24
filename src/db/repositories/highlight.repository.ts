import type Database from 'better-sqlite3';
import type { Tier } from '../../core/tiers.js';
import { defaultSpeed } from '../../core/storyboard/range.js';

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
  /** The moment is the edit: playback speed (1, 0.5, 0.25). `start_sec`/`end_sec` are the edited range. */
  speed: number;
  /** The analysis' original range (`resetMoment` goes back to it). */
  ai_start_sec: number;
  ai_end_sec: number;
  /** The user's override of `tier` (the ★), or null. */
  user_tier: Tier | null;
  seen_at: string | null;
  /** Motion measurement (null = never measured); valid only while the range equals `motion_start_sec`..`motion_end_sec`. */
  shake_score: number | null;
  shake_max_px: number | null;
  camera_motion: number | null;
  frame_change: number | null;
  motion_start_sec: number | null;
  motion_end_sec: number | null;
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
  private stmtReplaceable: Database.Statement;
  private stmtDelete: Database.Statement;
  private stmtSnap: Database.Statement;
  private stmtInsert: Database.Statement;
  private stmtFindByClip: Database.Statement;
  private stmtListByProject: Database.Statement;
  private stmtListAll: Database.Statement;
  private stmtRanges: Database.Statement;
  private stmtClearDup: Database.Statement;
  private stmtSetDup: Database.Statement;

  constructor(private db: Database.Database) {
    // Decisions survive re-analysis: confirmed/rejected moments, edited ones (range, speed, ★) and those a panel
    // or candidate list points at stay. This selects the proposed, unreferenced ones; edited ones are filtered in code.
    this.stmtReplaceable = db.prepare(`
      SELECT * FROM highlights
      WHERE clip_id = ? AND status = 'proposed'
        AND id NOT IN (SELECT moment_id FROM story_segments WHERE moment_id IS NOT NULL)
        AND id NOT IN (SELECT moment_id FROM panel_candidates)
    `);
    this.stmtRanges = db.prepare('SELECT start_sec, end_sec FROM highlights WHERE clip_id = ?');
    this.stmtDelete = db.prepare('DELETE FROM highlights WHERE id = ?');
    this.stmtSnap = db.prepare('UPDATE highlights SET start_sec = ?, end_sec = ?, ai_start_sec = ?, ai_end_sec = ? WHERE id = ?');
    this.stmtInsert = db.prepare(
      'INSERT INTO highlights (clip_id, start_sec, end_sec, description, tier, shot, role, issues, slowmo, slowmo_reason, suggested_speed, audio_keep, audio_type, speed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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

  /**
   * Moments a re-analysis (or any normaliser such as the speech snap) may change: proposed, not used by a panel or
   * candidate list, and untouched (range = analysis range, default speed, no ★). Everything else is protected
   * (confirmed, rejected, edited, in use) and is never changed by a tool.
   */
  findUnprotected(clipId: number): HighlightRecord[] {
    const fps = this.clipFps(clipId);
    const rows = this.stmtReplaceable.all(clipId) as HighlightRecord[];
    return rows.filter((r) => !(
      r.start_sec !== (r.ai_start_sec ?? r.start_sec) || r.end_sec !== (r.ai_end_sec ?? r.end_sec)
      || r.speed !== defaultSpeed(r.suggested_speed, fps) || r.user_tier !== null));
  }

  /** Set the range of an unprotected moment as the analysis' own range (ai range too), so it stays unprotected. */
  snapUnprotected(id: number, startSec: number, endSec: number): void {
    this.stmtSnap.run(startSec, endSec, startSec, endSec, id);
  }

  /** Store a motion measurement with the range it was measured on. Touches nothing else (not an edit). */
  setMotion(id: number, m: { score: number; maxPx: number; camera: number; change: number }, startSec: number, endSec: number): void {
    this.db.prepare(`UPDATE highlights SET shake_score = ?, shake_max_px = ?, camera_motion = ?, frame_change = ?,
      motion_start_sec = ?, motion_end_sec = ? WHERE id = ?`).run(m.score, m.maxPx, m.camera, m.change, startSec, endSec, id);
  }

  private clipFps(clipId: number): number | null | undefined {
    return (this.db.prepare('SELECT fps FROM clips WHERE id = ?').get(clipId) as { fps: number | null } | undefined)?.fps;
  }

  /**
   * Store a fresh analysis: proposed, unreferenced moments are replaced by `items`; moments that are
   * confirmed, rejected, edited (range / speed / ★), or used by a panel/candidate list are kept (so decisions
   * and the timeline survive). A new moment overlapping a kept one by >= 50 % of its own length is dropped (no
   * near-duplicates of what the user already worked on). New moments start at the fps-gated default speed.
   */
  replaceForClip(clipId: number, items: InsertHighlight[]): void {
    const fps = this.clipFps(clipId);
    this.db.transaction(() => {
      for (const r of this.findUnprotected(clipId)) this.stmtDelete.run(r.id);
      // Whatever is left now was kept (decided, edited or in use): do not re-propose the same stretch.
      const keptRanges = this.stmtRanges.all(clipId) as { start_sec: number; end_sec: number }[];
      for (const h of items) {
        const len = h.end_sec - h.start_sec;
        if (len > 0 && keptRanges.some((k) =>
          Math.min(h.end_sec, k.end_sec) - Math.max(h.start_sec, k.start_sec) >= len / 2)) continue;
        const suggested = h.suggested_speed ?? 1;
        this.stmtInsert.run(clipId, h.start_sec, h.end_sec, h.description, h.tier,
          h.shot ?? null, h.role ?? null, JSON.stringify(h.issues ?? []),
          h.slowmo ?? 'none', h.slowmo_reason ?? '', suggested,
          h.audio_keep ? 1 : 0, h.audio_type ?? 'noise', defaultSpeed(suggested, fps));
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
