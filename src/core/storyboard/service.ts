import type Database from 'better-sqlite3';
import type { BriefState, Cut, Panel, PanelSource, Scene } from '../../types/story.js';
import type { Clip } from '../../types/clip.js';
import type { HighlightRecord } from '../../db/repositories/highlight.repository.js';
import type { EventRecord } from '../../db/repositories/event.repository.js';
import { speedAllowed } from '../analyze/highlights.js';
import { BriefSchema, BriefStateSchema, formatIssues, type Draft } from './schema.js';
import { applyDraft as applyDraftImpl } from './draft.js';
import * as ops from './history.js';
import { isTier, tierRankSql, type Tier } from '../tiers.js';

export const MAIN_CUT_NAME = 'Main';
export const MIN_PANEL_SEC = 0.5;
const SPEEDS = [1, 0.5, 0.25];

export type PanelClip = Pick<Clip, 'id' | 'file_path' | 'proxy_path' | 'duration_sec' | 'fps' | 'resolution' | 'hidden'>;

export interface PanelNode extends Panel {
  clip: PanelClip | null;
  moment: HighlightRecord | null;
  candidates: HighlightRecord[];
}

export interface SceneNode extends Scene {
  event: Pick<EventRecord, 'id' | 'name'> | null;
  panels: PanelNode[];
}

export interface CutTree {
  cut: Cut;
  brief: unknown;
  brief_state: BriefState;
  scenes: SceneNode[];
  totals: { panels: number; filled: number; candidates: number; gaps: number; duration_sec: number };
}

export interface AddPanelInput {
  intent?: string;
  /** Fill from this moment (in/out/speed default to the moment's). Does not confirm the moment. */
  momentId?: number;
  candidates?: number[];
  startSec?: number;
  endSec?: number;
  speed?: number;
  source?: PanelSource;
}

export interface MomentRow {
  id: number;
  clip_id: number;
  event_id: number | null;
  start_sec: number;
  end_sec: number;
  tier: string;
  shot: string | null;
  role: string | null;
  issues: string[];
  slowmo: string;
  suggested_speed: number;
  audio_keep: boolean;
  audio_type: string;
  dup_group: number | null;
  status: string;
  description: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Storyboard logic (Cut -> Scene -> Panel) over the database. CLI and server routes are thin wrappers. */
export class StoryboardService {
  constructor(private db: Database.Database) {}

  // ---------- helpers ----------

  private tx<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  private moment(id: number): HighlightRecord {
    const m = this.db.prepare('SELECT * FROM highlights WHERE id = ?').get(id) as HighlightRecord | undefined;
    if (!m) throw new Error(`Moment ${id} not found`);
    return m;
  }

  private clip(id: number): Clip {
    const c = this.db.prepare('SELECT * FROM clips WHERE id = ?').get(id) as Clip | undefined;
    if (!c) throw new Error(`Clip ${id} not found`);
    return c;
  }

  private panel(id: number): Panel {
    const p = this.db.prepare('SELECT * FROM story_segments WHERE id = ?').get(id) as Panel | undefined;
    if (!p) throw new Error(`Panel ${id} not found`);
    return p;
  }

  private scene(id: number): Scene {
    const s = this.db.prepare('SELECT * FROM scenes WHERE id = ?').get(id) as Scene | undefined;
    if (!s) throw new Error(`Scene ${id} not found`);
    return s;
  }

  private assertUsable(m: HighlightRecord): void {
    if (m.status === 'rejected') throw new Error(`Moment ${m.id} is rejected`);
    if (this.clip(m.clip_id).hidden) throw new Error(`Clip ${m.clip_id} of moment ${m.id} is hidden`);
  }

  /** Rewrite positions of `ids` to 0..n-1 in the given order (two phases because of UNIQUE). */
  private writeOrder(table: 'scenes' | 'story_segments', ids: number[]): void {
    const tmp = this.db.prepare(`UPDATE ${table} SET position = ? WHERE id = ?`);
    ids.forEach((id) => tmp.run(-id - 1, id));
    ids.forEach((id, i) => tmp.run(i, id));
  }

  private sceneIds(storyId: number): number[] {
    return (this.db.prepare('SELECT id FROM scenes WHERE story_id = ? ORDER BY position').all(storyId) as { id: number }[]).map((r) => r.id);
  }

  private panelIds(sceneId: number): number[] {
    return (this.db.prepare('SELECT id FROM story_segments WHERE scene_id = ? ORDER BY position').all(sceneId) as { id: number }[]).map((r) => r.id);
  }

  private candidateIds(panelId: number): number[] {
    return (this.db.prepare('SELECT moment_id FROM panel_candidates WHERE panel_id = ? ORDER BY position').all(panelId) as { moment_id: number }[]).map((r) => r.moment_id);
  }

  private setCandidates(panelId: number, ids: number[]): void {
    this.db.prepare('DELETE FROM panel_candidates WHERE panel_id = ?').run(panelId);
    const ins = this.db.prepare('INSERT INTO panel_candidates (panel_id, moment_id, position) VALUES (?, ?, ?)');
    ids.forEach((m, i) => ins.run(panelId, m, i));
  }

  private insertAt(list: number[], id: number, position?: number): number[] {
    const at = position === undefined ? list.length : Math.max(0, Math.min(position, list.length));
    return [...list.slice(0, at), id, ...list.slice(at)];
  }

  // ---------- undo / redo ----------

  /** Run a mutation and log it as one undoable operation on `cutId`. Every route/CLI mutation goes through here. */
  command<T>(cutId: number, label: string, fn: () => T): T {
    return ops.command(this.db, cutId, label, fn);
  }

  undo(cutId: number): { label: string; can_undo: boolean; can_redo: boolean } {
    return ops.undo(this.db, cutId);
  }

  redo(cutId: number): { label: string; can_undo: boolean; can_redo: boolean } {
    return ops.redo(this.db, cutId);
  }

  history(cutId: number): ops.OperationInfo[] {
    return ops.history(this.db, cutId);
  }

  historyState(cutId: number): ops.HistoryState {
    return ops.historyState(this.db, cutId);
  }

  // ---------- cuts ----------

  createCut(projectId: number, name: string): Cut {
    const r = this.db.prepare('INSERT INTO stories (project_id, name) VALUES (?, ?)').run(projectId, name);
    return this.findCut(Number(r.lastInsertRowid))!;
  }

  private findCut(id: number): Cut | null {
    return (this.db.prepare('SELECT * FROM stories WHERE id = ?').get(id) as Cut) ?? null;
  }

  listCuts(projectId: number): Cut[] {
    return this.db.prepare('SELECT * FROM stories WHERE project_id = ? ORDER BY id ASC').all(projectId) as Cut[];
  }

  renameCut(id: number, name: string): void {
    if (!this.findCut(id)) throw new Error(`Cut ${id} not found`);
    this.db.prepare("UPDATE stories SET name = ?, updated_at = datetime('now') WHERE id = ?").run(name, id);
  }

  deleteCut(id: number): void {
    this.db.prepare('DELETE FROM stories WHERE id = ?').run(id);
  }

  /** The project's cut "Main"; created when missing. */
  getOrCreateMainCut(projectId: number): Cut {
    const found = this.db.prepare('SELECT * FROM stories WHERE project_id = ? AND name = ? ORDER BY id LIMIT 1')
      .get(projectId, MAIN_CUT_NAME) as Cut | undefined;
    return found ?? this.createCut(projectId, MAIN_CUT_NAME);
  }

  getCut(id: number): CutTree | null {
    const cut = this.findCut(id);
    if (!cut) return null;
    const scenes = this.db.prepare('SELECT * FROM scenes WHERE story_id = ? ORDER BY position').all(id) as Scene[];
    const panels = this.db.prepare('SELECT * FROM story_segments WHERE story_id = ? ORDER BY scene_id, position').all(id) as Panel[];

    const clipCache = new Map<number, PanelClip>();
    const clipOf = (cid: number | null): PanelClip | null => {
      if (cid === null) return null;
      if (!clipCache.has(cid)) {
        clipCache.set(cid, this.db.prepare(
          'SELECT id, file_path, proxy_path, duration_sec, fps, resolution, hidden FROM clips WHERE id = ?',
        ).get(cid) as PanelClip);
      }
      return clipCache.get(cid)!;
    };
    const momentStmt = this.db.prepare('SELECT * FROM highlights WHERE id = ?');
    const momentOf = (mid: number | null) => (mid === null ? null : ((momentStmt.get(mid) as HighlightRecord) ?? null));

    const totals = { panels: 0, filled: 0, candidates: 0, gaps: 0, duration_sec: 0 };
    const nodes: SceneNode[] = scenes.map((s) => {
      const event = s.event_id === null ? null
        : ((this.db.prepare('SELECT id, name FROM events WHERE id = ?').get(s.event_id) as SceneNode['event']) ?? null);
      const sp = panels.filter((p) => p.scene_id === s.id).map<PanelNode>((p) => {
        totals.panels++;
        if (p.state === 'filled') {
          totals.filled++;
          totals.duration_sec += (p.end_sec! - p.start_sec!) / p.speed;
        } else if (p.state === 'candidates') totals.candidates++;
        else totals.gaps++;
        return {
          ...p,
          clip: clipOf(p.clip_id),
          moment: momentOf(p.moment_id),
          candidates: this.candidateIds(p.id).map((mid) => momentOf(mid)!),
        };
      });
      return { ...s, event, panels: sp };
    });
    totals.duration_sec = round2(totals.duration_sec);

    return {
      cut,
      brief: cut.brief ? JSON.parse(cut.brief) : null,
      brief_state: cut.brief_state,
      scenes: nodes,
      totals,
    };
  }

  setBrief(cutId: number, brief: unknown, state: 'proposed' | 'confirmed'): void {
    if (!this.findCut(cutId)) throw new Error(`Cut ${cutId} not found`);
    const st = BriefStateSchema.safeParse(state);
    if (!st.success) throw new Error(`Invalid brief state "${state}" (use proposed or confirmed)`);
    const parsed = BriefSchema.safeParse(brief);
    if (!parsed.success) throw new Error(`Invalid brief: ${formatIssues(parsed.error).join('; ')}`);
    this.db.prepare("UPDATE stories SET brief = ?, brief_state = ?, updated_at = datetime('now') WHERE id = ?")
      .run(JSON.stringify(parsed.data), st.data, cutId);
  }

  /** Validate and apply a draft in one transaction; throws DraftValidationError listing every problem. */
  applyDraft(cutId: number, draft: Draft | unknown, opts: { mode: 'replace' | 'append' }): { scenes: number; panels: number } {
    return applyDraftImpl(this.db, this, cutId, draft, opts);
  }

  // ---------- scenes ----------

  addScene(cutId: number, name: string, opts: { position?: number } = {}): Scene {
    if (!this.findCut(cutId)) throw new Error(`Cut ${cutId} not found`);
    return this.tx(() => {
      const ids = this.sceneIds(cutId);
      const r = this.db.prepare('INSERT INTO scenes (story_id, position, name) VALUES (?, ?, ?)')
        .run(cutId, -1_000_000, name);
      const id = Number(r.lastInsertRowid);
      this.writeOrder('scenes', this.insertAt(ids, id, opts.position));
      return this.scene(id);
    });
  }

  renameScene(id: number, name: string): void {
    this.scene(id);
    this.db.prepare('UPDATE scenes SET name = ? WHERE id = ?').run(name, id);
  }

  deleteScene(id: number): void {
    const s = this.scene(id);
    this.tx(() => {
      this.db.prepare('DELETE FROM scenes WHERE id = ?').run(id);
      this.writeOrder('scenes', this.sceneIds(s.story_id));
    });
  }

  moveScene(id: number, position: number): void {
    const s = this.scene(id);
    this.tx(() => {
      const rest = this.sceneIds(s.story_id).filter((x) => x !== id);
      this.writeOrder('scenes', this.insertAt(rest, id, position));
    });
  }

  setSceneEvent(id: number, eventId: number | null): void {
    this.scene(id);
    this.db.prepare('UPDATE scenes SET event_id = ? WHERE id = ?').run(eventId, id);
  }

  // ---------- panels ----------

  addPanel(sceneId: number, input: AddPanelInput = {}, position?: number): Panel {
    const scene = this.scene(sceneId);
    return this.tx(() => {
      let state: Panel['state'] = 'gap';
      let clipId: number | null = null;
      let start: number | null = null;
      let end: number | null = null;
      let speed = input.speed ?? 1;
      if (input.momentId !== undefined) {
        const m = this.moment(input.momentId);
        this.assertUsable(m);
        state = 'filled';
        clipId = m.clip_id;
        start = input.startSec ?? m.start_sec;
        end = input.endSec ?? m.end_sec;
        speed = input.speed ?? m.suggested_speed;
      } else if (input.candidates?.length) {
        for (const id of input.candidates) this.assertUsable(this.moment(id));
        state = 'candidates';
      }
      const r = this.db.prepare(`
        INSERT INTO story_segments (story_id, scene_id, position, intent, state, source, clip_id, moment_id, start_sec, end_sec, speed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(scene.story_id, sceneId, -1_000_000, input.intent ?? '', state, input.source ?? 'ai',
        clipId, input.momentId ?? null, start, end, speed);
      const id = Number(r.lastInsertRowid);
      if (state === 'candidates') this.setCandidates(id, input.candidates!);
      this.writeOrder('story_segments', this.insertAt(this.panelIds(sceneId).filter((x) => x !== id), id, position));
      return this.panel(id);
    });
  }

  deletePanel(id: number): void {
    const p = this.panel(id);
    this.tx(() => {
      this.db.prepare('DELETE FROM story_segments WHERE id = ?').run(id);
      this.writeOrder('story_segments', this.panelIds(p.scene_id));
    });
  }

  movePanel(id: number, sceneId: number, position: number): void {
    const p = this.panel(id);
    const target = this.scene(sceneId);
    if (target.story_id !== p.story_id) throw new Error(`Scene ${sceneId} belongs to another cut`);
    this.tx(() => {
      const oldScene = p.scene_id;
      this.db.prepare('UPDATE story_segments SET scene_id = ?, position = ? WHERE id = ?').run(sceneId, -id - 1, id);
      this.writeOrder('story_segments', this.insertAt(this.panelIds(sceneId).filter((x) => x !== id), id, position));
      if (oldScene !== sceneId) this.writeOrder('story_segments', this.panelIds(oldScene));
    });
  }

  setIntent(id: number, intent: string): void {
    this.panel(id);
    this.db.prepare('UPDATE story_segments SET intent = ? WHERE id = ?').run(intent, id);
  }

  trimPanel(id: number, startSec: number, endSec: number): void {
    const p = this.panel(id);
    if (p.state !== 'filled') throw new Error(`Panel ${id} is not filled`);
    const dur = this.clip(p.clip_id!).duration_sec;
    const s = round2(Math.max(0, Math.min(startSec, dur)));
    const e = round2(Math.max(0, Math.min(endSec, dur)));
    if (e - s < MIN_PANEL_SEC) throw new Error(`Trim must leave at least ${MIN_PANEL_SEC} s`);
    this.db.prepare('UPDATE story_segments SET start_sec = ?, end_sec = ? WHERE id = ?').run(s, e, id);
  }

  setSpeed(id: number, speed: number): void {
    const p = this.panel(id);
    if (!SPEEDS.includes(speed)) throw new Error(`Invalid speed ${speed} (use 1, 0.5 or 0.25)`);
    if (speed !== 1) {
      if (p.clip_id === null) throw new Error(`Panel ${id} is not filled`);
      const fps = this.clip(p.clip_id).fps;
      if (!speedAllowed(speed, fps)) throw new Error(`Speed ${speed} needs a higher frame rate (clip is ${fps ?? 'unknown'} fps)`);
    }
    this.db.prepare('UPDATE story_segments SET speed = ? WHERE id = ?').run(speed, id);
  }

  // ---------- moments ----------

  /** Compact moment rows for drafting; hidden clips are excluded, rejected ones only on request. */
  listMoments(projectId: number, opts: { eventId?: number; minTier?: Tier; includeRejected?: boolean } = {}): MomentRow[] {
    if (opts.minTier !== undefined && !isTier(opts.minTier)) throw new Error(`Invalid tier "${opts.minTier}"`);
    const where = ['c.project_id = ?', 'c.hidden = 0'];
    const params: unknown[] = [projectId];
    if (opts.eventId !== undefined) { where.push('c.event_id = ?'); params.push(opts.eventId); }
    if (opts.minTier !== undefined) { where.push(`${tierRankSql('h.tier')} >= ${tierRankSql('?')}`); params.push(opts.minTier); }
    if (!opts.includeRejected) where.push("h.status <> 'rejected'");
    const rows = this.db.prepare(`
      SELECT h.*, c.event_id FROM highlights h JOIN clips c ON c.id = h.clip_id
      WHERE ${where.join(' AND ')} ORDER BY h.clip_id, h.start_sec, h.id
    `).all(...params) as (HighlightRecord & { event_id: number | null })[];
    return rows.map((h) => ({
      id: h.id, clip_id: h.clip_id, event_id: h.event_id, start_sec: h.start_sec, end_sec: h.end_sec,
      tier: h.tier, shot: h.shot, role: h.role, issues: JSON.parse(h.issues || '[]') as string[],
      slowmo: h.slowmo, suggested_speed: h.suggested_speed, audio_keep: Boolean(h.audio_keep),
      audio_type: h.audio_type, dup_group: h.dup_group, status: h.status, description: h.description,
    }));
  }

  placeMoment(panelId: number, momentId: number): void {
    this.panel(panelId);
    const m = this.moment(momentId);
    this.assertUsable(m);
    this.tx(() => {
      this.db.prepare(`
        UPDATE story_segments SET state = 'filled', source = 'user', clip_id = ?, moment_id = ?,
               start_sec = ?, end_sec = ?, speed = ? WHERE id = ?
      `).run(m.clip_id, m.id, m.start_sec, m.end_sec, m.suggested_speed, panelId);
      this.db.prepare('DELETE FROM panel_candidates WHERE panel_id = ?').run(panelId);
      this.db.prepare("UPDATE highlights SET status = 'confirmed', reject_reason = NULL WHERE id = ?").run(momentId);
    });
  }

  pickCandidate(panelId: number, momentId: number): void {
    this.panel(panelId);
    if (!this.candidateIds(panelId).includes(momentId)) throw new Error(`Moment ${momentId} is not a candidate of panel ${panelId}`);
    this.placeMoment(panelId, momentId);
  }

  rejectMoment(momentId: number, reason?: string): void {
    this.moment(momentId);
    this.tx(() => {
      this.db.prepare("UPDATE highlights SET status = 'rejected', reject_reason = ? WHERE id = ?").run(reason ?? null, momentId);
      this.detachMoments([momentId]);
    });
  }

  hideClip(clipId: number): void {
    this.clip(clipId);
    this.tx(() => {
      this.db.prepare('UPDATE clips SET hidden = 1 WHERE id = ?').run(clipId);
      const ids = (this.db.prepare('SELECT id FROM highlights WHERE clip_id = ?').all(clipId) as { id: number }[]).map((r) => r.id);
      this.detachMoments(ids);
      // Panels that point at the clip without a moment link are no longer usable either.
      this.db.prepare(`UPDATE story_segments SET ${GAP_SET} WHERE state = 'filled' AND clip_id = ?`).run(clipId);
    });
  }

  unhideClip(clipId: number): void {
    this.clip(clipId);
    this.db.prepare('UPDATE clips SET hidden = 0 WHERE id = ?').run(clipId);
  }

  /** Remove moments from candidate lists; filled panels using them become gaps. */
  private detachMoments(momentIds: number[]): void {
    for (const mid of momentIds) {
      const affected = (this.db.prepare('SELECT DISTINCT panel_id FROM panel_candidates WHERE moment_id = ?').all(mid) as { panel_id: number }[]).map((r) => r.panel_id);
      this.db.prepare('DELETE FROM panel_candidates WHERE moment_id = ?').run(mid);
      for (const pid of affected) {
        const rest = this.candidateIds(pid);
        this.setCandidates(pid, rest);
        if (rest.length === 0) this.db.prepare("UPDATE story_segments SET state = 'gap' WHERE id = ? AND state = 'candidates'").run(pid);
      }
      this.db.prepare(`UPDATE story_segments SET ${GAP_SET} WHERE state = 'filled' AND moment_id = ?`).run(mid);
    }
  }
}

const GAP_SET = "state = 'gap', clip_id = NULL, moment_id = NULL, start_sec = NULL, end_sec = NULL, speed = 1";
