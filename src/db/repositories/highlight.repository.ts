import type Database from 'better-sqlite3';
import type { Tier } from '../../core/tiers.js';
import { defaultSpeed } from '../../core/storyboard/range.js';

export type Shot = 'wide' | 'medium' | 'close' | 'detail';
export type AudioType = 'ambient' | 'speech' | 'music' | 'noise';
export type ShakeStatus = 'clean' | 'fixed' | 'kept';
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
  /** A speed the AI set itself (draft / `--ai` edits): not the user's speed edit. Null = the default speed counts. */
  ai_speed: number | null;
  /** The moment this one was cut out of (a shake cut out of a good moment leaves this sibling after it). */
  split_of: number | null;
  /** Shake fit (F1): null = not checked, else clean | fixed | kept; valid only while the range equals `shake_checked_*`. */
  shake_status: ShakeStatus | null;
  shake_note: string | null;
  shake_checked_start: number | null;
  shake_checked_end: number | null;
  seen_at: string | null;
  /** Motion measurement (null = never measured); valid only while the range equals `motion_start_sec`..`motion_end_sec`. */
  jitter_score: number | null;
  jitter_max_px: number | null;
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

/** Edits that make a moment the user's own: moved range, changed speed, a ★. */
function editReasons(r: HighlightRecord, fps: number | null | undefined): string[] {
  const reasons: string[] = [];
  if (r.start_sec !== (r.ai_start_sec ?? r.start_sec) || r.end_sec !== (r.ai_end_sec ?? r.end_sec)) reasons.push('trimmed');
  if (r.speed !== (r.ai_speed ?? defaultSpeed(r.suggested_speed, fps))) reasons.push('speed');
  if (r.user_tier !== null) reasons.push('starred');
  return reasons;
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
    return rows.filter((r) => editReasons(r, fps).length === 0);
  }

  /**
   * Why a tool must not change this moment: the user decided it (`confirmed`, `rejected`) or edited it (`trimmed`,
   * `speed`, `starred`). Same definition as `findUnprotected` except "used by a panel", which is no reason for
   * the critics (every moment they look at is in a panel). Empty = the moment is an untouched AI proposal.
   */
  protectionReasons(id: number): string[] {
    const r = this.db.prepare('SELECT * FROM highlights WHERE id = ?').get(id) as HighlightRecord | undefined;
    if (!r) return [];
    const reasons: string[] = [];
    if (r.status === 'confirmed' || r.status === 'rejected') reasons.push(r.status);
    return [...reasons, ...editReasons(r, this.clipFps(r.clip_id))];
  }

  /** Other moments of the same duplicate group (same project), rejected ones left out. */
  dupGroupMembers(id: number): number[] {
    const rows = this.db.prepare(`SELECT o.id FROM highlights h
      JOIN clips hc ON hc.id = h.clip_id
      JOIN highlights o ON o.dup_group = h.dup_group AND o.id <> h.id AND o.status <> 'rejected'
      JOIN clips oc ON oc.id = o.clip_id AND oc.project_id IS hc.project_id
      WHERE h.id = ? AND h.dup_group IS NOT NULL ORDER BY o.id`).all(id) as { id: number }[];
    return rows.map((r) => r.id);
  }

  /** Set the range of an unprotected moment as the analysis' own range (ai range too), so it stays unprotected. */
  snapUnprotected(id: number, startSec: number, endSec: number): void {
    this.stmtSnap.run(startSec, endSec, startSec, endSec, id);
  }

  /** Store a motion measurement with the range it was measured on. Touches nothing else (not an edit). */
  setMotion(id: number, m: { score: number; maxPx: number; camera: number; change: number }, startSec: number, endSec: number): void {
    this.db.prepare(`UPDATE highlights SET jitter_score = ?, jitter_max_px = ?, camera_motion = ?, frame_change = ?,
      motion_start_sec = ?, motion_end_sec = ? WHERE id = ?`).run(m.score, m.maxPx, m.camera, m.change, startSec, endSec, id);
  }

  /** Store the shake fit result for the range it was decided on. Not an edit. */
  setShakeStatus(id: number, status: ShakeStatus, note: string | null, startSec: number, endSec: number): void {
    this.db.prepare('UPDATE highlights SET shake_status = ?, shake_note = ?, shake_checked_start = ?, shake_checked_end = ? WHERE id = ?')
      .run(status, note, startSec, endSec, id);
  }

  /** Forget the shake fit results of a clip (its shakes were measured again). */
  clearShakeStatus(clipId: number): void {
    this.db.prepare('UPDATE highlights SET shake_status = NULL, shake_note = NULL, shake_checked_start = NULL, shake_checked_end = NULL WHERE clip_id = ?').run(clipId);
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

  findById(id: number): HighlightRecord | undefined {
    return this.db.prepare('SELECT * FROM highlights WHERE id = ?').get(id) as HighlightRecord | undefined;
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
