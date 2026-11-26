import { similarTo, lookGroups, type LookMoment } from '../look/similar.js';
import { lookState } from '../look/stale.js';
import type Database from 'better-sqlite3';
import type { BriefState, Cut, Panel, PanelSource, Scene } from '../../types/story.js';
import type { Clip } from '../../types/clip.js';
import type { HighlightRecord, ShakeStatus } from '../../db/repositories/highlight.repository.js';
import { shakeStateOf } from '../shakes/state.js';
import type { EventRecord } from '../../db/repositories/event.repository.js';
import { speedAllowed } from '../analyze/highlights.js';
import { HighlightRepository } from '../../db/repositories/highlight.repository.js';
import { BriefSchema, BriefStateSchema, formatIssues, type Draft } from './schema.js';
import { applyDraft as applyDraftImpl } from './draft.js';
import type { DraftWarning } from './rules.js';
import * as ops from './history.js';
import { defaultSpeed } from './range.js';
import { isTier, tierRankSql, type Tier } from '../tiers.js';
import { speechForRange, type SpeechCut } from '../transcribe/speech.js';
import { jitterBand, type JitterBand, type JitterBandConfig } from '../motion/motion.js';
import { isMeasured } from '../motion/index.js';
import { momentMotion, shakesForMoment, type ShakeView } from '../motion/curve.js';
import { MotionRepository, type StoredCurve } from '../../db/repositories/motion.repository.js';
import type { Shake } from '../motion/curve.js';
import { DEFAULT_CONFIG } from '../config/defaults.js';
import type { TranscriptSegment, TranscriptWord } from '../transcribe/whisper.js';

export const MAIN_CUT_NAME = 'Main';
export const MIN_PANEL_SEC = 0.5;
/** Both parts left by a cut-out must be at least this long. */
export const MIN_CUT_PART_SEC = 1;
const SPEEDS = [1, 0.5, 0.25];

export type PanelClip = Pick<Clip, 'id' | 'file_path' | 'proxy_path' | 'duration_sec' | 'fps' | 'resolution' | 'hidden'>;

/** What is said inside a moment (null when its clip has no transcript) and whether the moment cuts a sentence. */
export interface MomentSpeech {
  speech: string | null;
  speech_cut: SpeechCut;
}

/**
 * Measured jitter and stillness of a moment's current range, derived from the clip's motion curve (W1; the stored
 * columns when there is no curve and they are not stale); null when not measured. `shakes` = the single jolts inside
 * the range, null when the clip has no curve.
 */
export interface MomentMotion {
  jitter: { score: number; band: JitterBand } | null;
  motion: { camera: number; change: number } | null;
  shakes: ShakeView[] | null;
  /** Shake fit (F1): clean | fixed | kept, or null = not checked for the current range; `shake_note` says why it was kept. */
  shake_status: ShakeStatus | null;
  shake_note: string | null;
}

/** One clip's stored motion data, loaded once per read. */
type ClipMotion = { curve: StoredCurve; shakes: Shake[] } | null;
type MotionCache = Map<number, ClipMotion>;

export type MomentWithSpeech = HighlightRecord & MomentSpeech & MomentMotion;

export interface PanelNode extends Panel {
  /** Range and speed of the panel's moment (a panel stores none of its own); null / 1 unless the panel is filled. */
  start_sec: number | null;
  end_sec: number | null;
  speed: number;
  clip: PanelClip | null;
  moment: MomentWithSpeech | null;
  candidates: MomentWithSpeech[];
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
  /** Point at this moment. A user-sourced panel confirms it. */
  momentId?: number;
  candidates?: number[];
  /** Explicit in/out/speed (from a draft) are written to the moment, without confirming it. */
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
  /** The moment's playback speed (the edit). */
  speed: number;
  /** The analysis' original in/out (what "reset" returns to). */
  ai_start_sec: number;
  ai_end_sec: number;
  /** Effective tier: `user_tier ?? ai_tier`. */
  tier: string;
  ai_tier: string;
  user_tier: string | null;
  seen: boolean;
  shot: string | null;
  role: string | null;
  issues: string[];
  slowmo: string;
  suggested_speed: number;
  audio_keep: boolean;
  audio_type: string;
  dup_group: number | null;
  /** Look group (SM-7): id of the moment's average-linkage group in its event; null = alone / no fresh fingerprint. */
  look_group: number | null;
  status: string;
  description: string;
  /** Spoken words inside the range (null = clip not transcribed) and which boundary cuts a sentence. */
  speech: string | null;
  speech_cut: SpeechCut;
  jitter: MomentMotion['jitter'];
  motion: MomentMotion['motion'];
  shakes: MomentMotion['shakes'];
  shake_status: MomentMotion['shake_status'];
  shake_note: MomentMotion['shake_note'];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Storyboard logic (Cut -> Scene -> Panel) over the database. CLI and server routes are thin wrappers. */
export class StoryboardService {
  constructor(
    private db: Database.Database,
    private jitterCfg: JitterBandConfig = DEFAULT_CONFIG,
  ) {}

  private motionOf(m: HighlightRecord, cache: MotionCache): MomentMotion {
    return { ...this.motionValues(m, cache), ...shakeStateOf(m) };
  }

  private motionValues(m: HighlightRecord, cache: MotionCache): Omit<MomentMotion, 'shake_status' | 'shake_note'> {
    if (!cache.has(m.clip_id)) {
      const repo = new MotionRepository(this.db);
      const curve = repo.getCurve(m.clip_id);
      cache.set(m.clip_id, curve ? { curve, shakes: repo.getShakes(m.clip_id) } : null);
    }
    const cm = cache.get(m.clip_id)!;
    if (cm) {
      const v = momentMotion(cm.curve, m.start_sec, m.end_sec);
      return {
        jitter: { score: v.jitter.score, band: jitterBand(v.jitter.score, this.jitterCfg) },
        motion: { camera: v.camera, change: v.change },
        shakes: shakesForMoment(cm.shakes, cm.curve.medianResidual, m.start_sec, m.end_sec, m.speed ?? 1),
      };
    }
    if (!isMeasured(m)) return { jitter: null, motion: null, shakes: null };
    return {
      jitter: { score: m.jitter_score!, band: jitterBand(m.jitter_score!, this.jitterCfg) },
      motion: { camera: m.camera_motion ?? 0, change: m.frame_change ?? 0 },
      shakes: null,
    };
  }

  // ---------- helpers ----------

  /** Speech of a moment's range from the clip's transcript; `cache` holds one transcript per clip. */
  private speechOf(
    m: { clip_id: number; start_sec: number; end_sec: number },
    cache: Map<number, { segments: TranscriptSegment[]; words: TranscriptWord[] } | null>,
  ): MomentSpeech {
    if (!cache.has(m.clip_id)) {
      const r = this.db.prepare('SELECT segments_json, words_json FROM transcripts WHERE clip_id = ?').get(m.clip_id) as
        { segments_json: string; words_json: string } | undefined;
      cache.set(m.clip_id, r ? { segments: JSON.parse(r.segments_json), words: JSON.parse(r.words_json) } : null);
    }
    const t = cache.get(m.clip_id)!;
    if (!t) return { speech: null, speech_cut: null };
    const { text, cut } = speechForRange(t.segments, t.words, m.start_sec, m.end_sec);
    return { speech: text, speech_cut: cut };
  }

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

  /** Run a mutation and log it as one undoable operation on `cutId` (actor `user` unless `{ actor: 'ai' }`). Every route/CLI mutation goes through here. */
  command<T>(cutId: number, label: string, fn: () => T, opts: { actor?: ops.Actor } = {}): T {
    return ops.command(this.db, cutId, label, fn, opts);
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

  /** Cheap change marker for live refresh: latest operation id (undone ones included) + undo/redo state. */
  head(cutId: number): ops.HistoryState & { op_id: number | null } {
    const r = this.db.prepare('SELECT MAX(id) AS id FROM operations WHERE story_id = ?').get(cutId) as { id: number | null };
    return { op_id: r.id, ...ops.historyState(this.db, cutId) };
  }

  /**
   * Look fingerprints of a project's moments for ranking: fresh ones only (missing / stale -> `vec` null), rejected
   * moments and hidden clips flagged `out`.
   */
  private lookMoments(projectId: number): LookMoment[] {
    const rows = this.db.prepare(`SELECT h.id, h.start_sec, h.end_sec, h.status, h.look_vec, h.look_start_sec, h.look_end_sec,
        c.event_id, c.recorded_at, c.hidden FROM highlights h JOIN clips c ON c.id = h.clip_id WHERE c.project_id = ?`)
      .all(projectId) as (Parameters<typeof lookState>[0] & { id: number; status: string; event_id: number | null; recorded_at: string | null; hidden: number })[];
    return rows.map((r) => ({
      id: r.id, event_id: r.event_id, out: r.status === 'rejected' || r.hidden !== 0,
      rec_sec: (Date.parse(r.recorded_at ?? '') || 0) / 1000 + r.start_sec,
      vec: lookState(r) === 'fresh' ? new Float32Array(new Uint8Array(r.look_vec!).buffer) : null,
    }));
  }

  /** Per moment of the project: ids of its similar moments (same event, by look), nearest first (SM2). */
  similarIds(projectId: number): Map<number, number[]> {
    const ms = this.lookMoments(projectId);
    const groups = lookGroups(ms);
    return new Map(ms.map((m) => [m.id, similarTo(m, ms, groups).similar]));
  }

  /** Similar moments of one moment (see `similarIds`); a moment without a fresh fingerprint has none. */
  alternatives(momentId: number): number[] {
    const row = this.db.prepare('SELECT c.project_id FROM highlights h JOIN clips c ON c.id = h.clip_id WHERE h.id = ?')
      .get(momentId) as { project_id: number } | undefined;
    if (!row) return [];
    const ms = this.lookMoments(row.project_id);
    const subject = ms.find((m) => m.id === momentId);
    return subject ? similarTo(subject, ms, lookGroups(ms)).similar : [];
  }

  // ---------- lookups for logging (which cut an edit belongs to, human names for labels) ----------

  cutIdOfScene(sceneId: number): number { return this.scene(sceneId).story_id; }

  cutIdOfPanel(panelId: number): number { return this.panel(panelId).story_id; }

  /** "panel N": 1-based position of the panel within its scene. */
  panelNo(panelId: number): number { return this.panel(panelId).position + 1; }

  sceneName(sceneId: number): string { return this.scene(sceneId).name; }

  clipFileName(clipId: number): string {
    const p = this.clip(clipId).file_path;
    return p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1);
  }

  projectIdOfClip(clipId: number): number {
    const pid = this.clip(clipId).project_id;
    if (pid === null) throw new Error(`Clip ${clipId} has no project`);
    return pid;
  }

  projectIdOfMoment(momentId: number): number { return this.projectIdOfClip(this.moment(momentId).clip_id); }

  projectIdOfCut(cutId: number): number {
    const c = this.findCut(cutId);
    if (!c) throw new Error(`Cut ${cutId} not found`);
    return c.project_id;
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
    const transcripts = new Map<number, { segments: TranscriptSegment[]; words: TranscriptWord[] } | null>();
    const motions: MotionCache = new Map();
    const momentOf = (mid: number | null): MomentWithSpeech | null => {
      if (mid === null) return null;
      const m = momentStmt.get(mid) as HighlightRecord | undefined;
      return m ? { ...m, ...this.speechOf(m, transcripts), ...this.motionOf(m, motions) } : null;
    };

    const totals = { panels: 0, filled: 0, candidates: 0, gaps: 0, duration_sec: 0 };
    const nodes: SceneNode[] = scenes.map((s) => {
      const event = s.event_id === null ? null
        : ((this.db.prepare('SELECT id, name FROM events WHERE id = ?').get(s.event_id) as SceneNode['event']) ?? null);
      const sp = panels.filter((p) => p.scene_id === s.id).map<PanelNode>((p) => {
        totals.panels++;
        const moment = momentOf(p.moment_id);
        const filled = p.state === 'filled' && moment !== null;
        if (p.state === 'filled') {
          totals.filled++;
          if (moment) totals.duration_sec += (moment.end_sec - moment.start_sec) / moment.speed;
        } else if (p.state === 'candidates') totals.candidates++;
        else totals.gaps++;
        return {
          ...p,
          start_sec: filled ? moment.start_sec : null,
          end_sec: filled ? moment.end_sec : null,
          speed: filled ? moment.speed : 1,
          clip: clipOf(p.clip_id),
          moment,
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
  applyDraft(cutId: number, draft: Draft | unknown, opts: { mode: 'replace' | 'append' }): { scenes: number; panels: number; warnings: DraftWarning[] } {
    return applyDraftImpl(this.db, this, cutId, draft, opts);
  }

  // ---------- scenes ----------

  addScene(cutId: number, name: string, opts: { position?: number; eventId?: number | null } = {}): Scene {
    if (!this.findCut(cutId)) throw new Error(`Cut ${cutId} not found`);
    return this.tx(() => {
      const ids = this.sceneIds(cutId);
      const r = this.db.prepare('INSERT INTO scenes (story_id, position, name) VALUES (?, ?, ?)')
        .run(cutId, -1_000_000, name);
      const id = Number(r.lastInsertRowid);
      this.writeOrder('scenes', this.insertAt(ids, id, opts.position));
      if (opts.eventId !== undefined && opts.eventId !== null) this.setSceneEvent(id, opts.eventId);
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
      if (input.momentId !== undefined) {
        const m = this.moment(input.momentId);
        this.assertUsable(m);
        state = 'filled';
        clipId = m.clip_id;
        // Explicit in/out/speed only shape a moment nobody has touched; a confirmed moment keeps the user's edit.
        if (m.status === 'proposed') {
          if (input.startSec !== undefined || input.endSec !== undefined) {
            this.writeMomentRange(m, input.startSec ?? m.start_sec, input.endSec ?? m.end_sec);
            // A draft's range is the AI's choice, so the board must not show it as "changed by you".
            // Speed has no ai_* column: history judges it against suggested_speed, and the board only flags the range.
            if (input.source !== 'user') {
              this.db.prepare('UPDATE highlights SET ai_start_sec = start_sec, ai_end_sec = end_sec WHERE id = ?').run(m.id);
            }
          }
          if (input.speed !== undefined) {
            this.writeMomentSpeed(m, input.speed);
            // Same for the speed: a draft's speed is the AI's choice, not a speed edit by the user.
            if (input.source !== 'user') this.recordAiSpeed(m.id);
          }
        }
        if (input.source === 'user') this.confirmMoment(m.id);
      } else if (input.candidates?.length) {
        for (const id of input.candidates) this.assertUsable(this.moment(id));
        state = 'candidates';
      }
      const r = this.db.prepare(`
        INSERT INTO story_segments (story_id, scene_id, position, intent, state, source, clip_id, moment_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(scene.story_id, sceneId, -1_000_000, input.intent ?? '', state, input.source ?? 'ai',
        clipId, input.momentId ?? null);
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

  private confirmMoment(momentId: number): void {
    this.db.prepare("UPDATE highlights SET status = 'confirmed', reject_reason = NULL WHERE id = ?").run(momentId);
  }

  // ---------- the moment is the edit: range, speed, tier ----------

  /** Range of a moment, clamped to its clip. Throws when less than MIN_PANEL_SEC would remain. No touch. */
  private writeMomentRange(m: HighlightRecord, startSec: number, endSec: number): void {
    const dur = this.clip(m.clip_id).duration_sec;
    const s = round2(Math.max(0, Math.min(startSec, dur)));
    const e = round2(Math.max(0, Math.min(endSec, dur)));
    if (e - s < MIN_PANEL_SEC) throw new Error(`Trim must leave at least ${MIN_PANEL_SEC} s`);
    this.db.prepare('UPDATE highlights SET start_sec = ?, end_sec = ? WHERE id = ?').run(s, e, m.id);
  }

  /** Speed of a moment (1, 0.5, 0.25), gated by the clip's frame rate. No touch. */
  private writeMomentSpeed(m: HighlightRecord, speed: number): void {
    if (!SPEEDS.includes(speed)) throw new Error(`Invalid speed ${speed} (use 1, 0.5 or 0.25)`);
    const fps = this.clip(m.clip_id).fps;
    if (!speedAllowed(speed, fps)) throw new Error(`Speed ${speed} needs a higher frame rate (clip is ${fps ?? 'unknown'} fps)`);
    this.db.prepare('UPDATE highlights SET speed = ? WHERE id = ?').run(speed, m.id);
  }

  /** The user edited a moment: it counts as confirmed (a rejected one stays rejected) and every panel using it is theirs. */
  private touchMoment(m: HighlightRecord): void {
    if (m.status !== 'rejected') this.confirmMoment(m.id);
    this.db.prepare("UPDATE story_segments SET source = 'user' WHERE moment_id = ?").run(m.id);
  }

  /** The moment must be an untouched AI proposal before a tool (`--ai`) may change it. */
  private assertUnprotected(m: HighlightRecord): void {
    const reasons = new HighlightRepository(this.db).protectionReasons(m.id);
    if (reasons.length) throw new Error(`Moment ${m.id} is protected (${reasons.join(', ')}); only you can change it`);
  }

  /** The moment's current range becomes its AI range (an AI edit is not "trimmed" by the user). */
  private adoptRangeAsAi(id: number): void {
    this.db.prepare('UPDATE highlights SET ai_start_sec = start_sec, ai_end_sec = end_sec WHERE id = ?').run(id);
  }

  /** The moment's current speed is the AI's own choice (null when it equals the default speed). */
  private recordAiSpeed(id: number): void {
    const m = this.moment(id);
    const aiSpeed = m.speed === defaultSpeed(m.suggested_speed, this.clip(m.clip_id).fps) ? null : m.speed;
    this.db.prepare('UPDATE highlights SET ai_speed = ? WHERE id = ?').run(aiSpeed, id);
  }

  /** `ai`: an edit by Claude in the review loop; the moment stays unconfirmed and unprotected (refused when it is protected). */
  trimMoment(id: number, startSec: number, endSec: number, opts: { ai?: boolean } = {}): void {
    const m = this.moment(id);
    this.tx(() => {
      if (opts.ai) this.assertUnprotected(m);
      this.writeMomentRange(m, startSec, endSec);
      if (opts.ai) this.adoptRangeAsAi(id);
      else this.touchMoment(m);
    });
  }

  setMomentSpeed(id: number, speed: number, opts: { ai?: boolean } = {}): void {
    const m = this.moment(id);
    this.tx(() => {
      if (opts.ai) this.assertUnprotected(m);
      this.writeMomentSpeed(m, speed);
      if (opts.ai) this.recordAiSpeed(id);
      else this.touchMoment(m);
    });
  }

  /** A new unprotected AI moment on the same clip with the same tags / speed, covering `startSec`..`endSec`, `split_of` = `m`. */
  private insertSibling(m: HighlightRecord, startSec: number, endSec: number): number {
    const fps = this.clip(m.clip_id).fps;
    const r = this.db.prepare(`INSERT INTO highlights (clip_id, start_sec, end_sec, ai_start_sec, ai_end_sec, description, tier, shot, role,
        issues, slowmo, slowmo_reason, suggested_speed, audio_keep, audio_type, speed, ai_speed, split_of)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(m.clip_id, startSec, endSec, startSec, endSec, m.description, m.tier, m.shot, m.role, m.issues, m.slowmo,
        m.slowmo_reason, m.suggested_speed, m.audio_keep, m.audio_type, m.speed,
        m.speed === defaultSpeed(m.suggested_speed, fps) ? null : m.speed, m.id);
    return Number(r.lastInsertRowid);
  }

  /**
   * Split an unprotected AI moment into `parts` (ordered, inside the moment, each >= 1 s; F1 shake fit): the moment keeps
   * the first part, every other part becomes a sibling AI moment (`split_of`), and every panel that uses the moment, in
   * every cut, gets one panel per sibling right behind it (a user's panel stays the user's). Nothing is confirmed.
   */
  splitMoment(id: number, parts: { start: number; end: number }[]): { sibling_ids: number[]; panels: number[] } {
    const m = this.moment(id);
    return this.tx(() => {
      this.assertUsable(m);
      this.assertUnprotected(m);
      if (parts.length < 2) throw new Error('A split needs at least two parts');
      parts.forEach((p, i) => {
        if (p.start < m.start_sec - 1e-9 || p.end > m.end_sec + 1e-9) throw new Error(`Part ${p.start}-${p.end} must be inside the moment (${m.start_sec}-${m.end_sec})`);
        if (p.end - p.start < MIN_CUT_PART_SEC - 1e-9) throw new Error(`Every part must be at least ${MIN_CUT_PART_SEC} s`);
        if (i > 0 && p.start < parts[i - 1]!.end) throw new Error('Parts must be in order and must not overlap');
      });
      this.writeMomentRange(m, parts[0]!.start, parts[0]!.end);
      this.adoptRangeAsAi(id);
      const siblings = parts.slice(1).map((p) => this.insertSibling(m, p.start, p.end));

      const using = this.db.prepare('SELECT id FROM story_segments WHERE moment_id = ? ORDER BY story_id, scene_id, position').all(id) as { id: number }[];
      const panels: number[] = [];
      for (const { id: panelId } of using) {
        const p = this.panel(panelId);
        let anchor = panelId;
        for (const sib of siblings) {
          const added = this.addPanel(p.scene_id, { intent: p.intent, momentId: sib, source: 'ai' }, this.panel(anchor).position + 1);
          if (p.source === 'user') this.db.prepare("UPDATE story_segments SET source = 'user' WHERE id = ?").run(added.id);
          panels.push(added.id);
          anchor = added.id;
        }
      }
      return { sibling_ids: siblings, panels };
    });
  }

  /**
   * Cut `[fromSec, toSec]` out of a moment (a shake): the moment keeps the part before, a new sibling moment (same
   * clip and tags, `split_of`) gets the part after and a panel of its own right behind every panel of `cutId` that
   * uses the moment (only `panelId` when given). The sibling is always an unprotected AI moment; the trimmed moment
   * is the user's decision unless `ai`.
   */
  cutOutMoment(id: number, fromSec: number, toSec: number, opts: { ai?: boolean; cutId: number; panelId?: number }): { sibling_id: number; panels: number[] } {
    const m = this.moment(id);
    return this.tx(() => {
      this.assertUsable(m);
      if (fromSec < m.start_sec || toSec > m.end_sec) throw new Error(`Cut out ${fromSec}-${toSec} must be inside the moment (${m.start_sec}-${m.end_sec})`);
      if (toSec <= fromSec) throw new Error('Cut out must start before it ends');
      if (fromSec - m.start_sec < MIN_CUT_PART_SEC - 1e-9) throw new Error(`Cut out must leave at least ${MIN_CUT_PART_SEC} s before the cut`);
      if (m.end_sec - toSec < MIN_CUT_PART_SEC - 1e-9) throw new Error(`Cut out must leave at least ${MIN_CUT_PART_SEC} s after the cut`);
      if (opts.ai) this.assertUnprotected(m);

      this.writeMomentRange(m, m.start_sec, fromSec);
      if (opts.ai) this.adoptRangeAsAi(id);
      else this.touchMoment(m);

      const siblingId = this.insertSibling(m, toSec, m.end_sec);

      const using = this.db.prepare('SELECT id FROM story_segments WHERE story_id = ? AND moment_id = ? ORDER BY scene_id, position')
        .all(opts.cutId, id) as { id: number }[];
      const panels: number[] = [];
      for (const { id: panelId } of using) {
        if (opts.panelId !== undefined && panelId !== opts.panelId) continue;
        const p = this.panel(panelId);
        const added = this.addPanel(p.scene_id, { intent: p.intent, momentId: siblingId, source: 'ai' }, p.position + 1);
        if (p.source === 'user') this.db.prepare("UPDATE story_segments SET source = 'user' WHERE id = ?").run(added.id);
        panels.push(added.id);
      }
      return { sibling_id: siblingId, panels };
    });
  }

  /**
   * BE4: a new moment on `clipId` for `startSec`..`endSec` (clamped to the clip, at least MIN_PANEL_SEC). The user's is
   * confirmed (protected like any user edit); an `ai` one stays proposed and unprotected. Tier solid, speed 1, no analysis.
   */
  createMoment(clipId: number, startSec: number, endSec: number, opts: { ai?: boolean; description?: string } = {}): number {
    const clip = this.clip(clipId);
    if (clip.hidden) throw new Error(`Clip ${clipId} is hidden`);
    const s = round2(Math.max(0, Math.min(startSec, clip.duration_sec)));
    const e = round2(Math.max(0, Math.min(endSec, clip.duration_sec)));
    if (e - s < MIN_PANEL_SEC) throw new Error(`A moment must be at least ${MIN_PANEL_SEC} s long`);
    const r = this.db.prepare(`INSERT INTO highlights (clip_id, start_sec, end_sec, ai_start_sec, ai_end_sec, description, tier, status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, 'solid', ?, ?)`)
      .run(clipId, s, e, s, e, opts.description?.trim() ?? '', opts.ai ? 'proposed' : 'confirmed', opts.ai ? 'ai' : 'user');
    return Number(r.lastInsertRowid);
  }

  /** ★: the user's tier for the moment (null = back to the AI's tier). Not a confirmation. */
  setMomentTier(id: number, tier: Tier | null): void {
    this.moment(id);
    if (tier !== null && !isTier(tier)) throw new Error(`Invalid tier "${String(tier)}" (use hero, solid, filler or null)`);
    this.db.prepare('UPDATE highlights SET user_tier = ? WHERE id = ?').run(tier, id);
  }

  /** Star / unstar: star = hero; unstar = back to the AI's tier, or solid when the AI itself said hero. */
  starMoment(id: number, starred: boolean): void {
    const m = this.moment(id);
    this.setMomentTier(id, starred ? 'hero' : (m.tier === 'hero' ? 'solid' : null));
  }

  /** Back to the analysis' range and the default speed (status and ★ stay). */
  resetMoment(id: number): void {
    const m = this.moment(id);
    const speed = defaultSpeed(m.suggested_speed, this.clip(m.clip_id).fps);
    this.db.prepare('UPDATE highlights SET start_sec = ?, end_sec = ?, speed = ?, ai_speed = NULL WHERE id = ?')
      .run(m.ai_start_sec ?? m.start_sec, m.ai_end_sec ?? m.end_sec, speed, id);
  }

  // ---------- moments ----------

  /** Compact moment rows for drafting; hidden clips and rejected moments are excluded unless requested. */
  listMoments(projectId: number, opts: { eventId?: number; minTier?: Tier; includeRejected?: boolean; includeHidden?: boolean } = {}): MomentRow[] {
    if (opts.minTier !== undefined && !isTier(opts.minTier)) throw new Error(`Invalid tier "${opts.minTier}"`);
    const where = ['c.project_id = ?'];
    if (!opts.includeHidden) where.push('c.hidden = 0');
    const params: unknown[] = [projectId];
    if (opts.eventId !== undefined) { where.push('c.event_id = ?'); params.push(opts.eventId); }
    if (opts.minTier !== undefined) { where.push(`${tierRankSql('h.tier')} >= ${tierRankSql('?')}`); params.push(opts.minTier); }
    if (!opts.includeRejected) where.push("h.status <> 'rejected'");
    const rows = this.db.prepare(`
      SELECT h.*, c.event_id FROM highlights h JOIN clips c ON c.id = h.clip_id
      WHERE ${where.join(' AND ')} ORDER BY h.clip_id, h.start_sec, h.id
    `).all(...params) as (HighlightRecord & { event_id: number | null })[];
    const transcripts = new Map<number, { segments: TranscriptSegment[]; words: TranscriptWord[] } | null>();
    const motions: MotionCache = new Map();
    const groups = lookGroups(this.lookMoments(projectId));
    return rows.map((h) => ({
      ...this.speechOf(h, transcripts),
      ...this.motionOf(h, motions),
      id: h.id, clip_id: h.clip_id, event_id: h.event_id, start_sec: h.start_sec, end_sec: h.end_sec,
      speed: h.speed, ai_start_sec: h.ai_start_sec, ai_end_sec: h.ai_end_sec,
      tier: h.user_tier ?? h.tier, ai_tier: h.tier, user_tier: h.user_tier, seen: h.seen_at !== null, shot: h.shot, role: h.role, issues: JSON.parse(h.issues || '[]') as string[],
      slowmo: h.slowmo, suggested_speed: h.suggested_speed, audio_keep: Boolean(h.audio_keep),
      audio_type: h.audio_type, dup_group: h.dup_group, look_group: groups.get(h.id) ?? null, status: h.status, description: h.description,
    }));
  }

  /** Board state, not an edit: stored on the moment, never logged in `operations` or part of an undo snapshot. */
  setMomentSeen(momentId: number, seen: boolean): void {
    this.moment(momentId);
    this.db.prepare('UPDATE highlights SET seen_at = ? WHERE id = ?').run(seen ? new Date().toISOString() : null, momentId);
  }

  /** `ai`: Claude's pick (review loop): the panel stays an AI panel and the moment is not confirmed. */
  placeMoment(panelId: number, momentId: number, opts: { ai?: boolean } = {}): void {
    const panel = this.panel(panelId);
    const m = this.moment(momentId);
    this.assertUsable(m);
    if (opts.ai && panel.source === 'user') throw new Error(`Panel ${panelId} was placed by the user; only you can change it`);
    this.tx(() => {
      this.db.prepare("UPDATE story_segments SET state = 'filled', source = ?, clip_id = ?, moment_id = ? WHERE id = ?")
        .run(opts.ai ? 'ai' : 'user', m.clip_id, m.id, panelId);
      this.db.prepare('DELETE FROM panel_candidates WHERE panel_id = ?').run(panelId);
      if (!opts.ai) this.db.prepare("UPDATE highlights SET status = 'confirmed', reject_reason = NULL WHERE id = ?").run(momentId);
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

  /** Undo a rejection: the moment is proposed again (it is not re-added to any panel). */
  unrejectMoment(momentId: number): void {
    this.moment(momentId);
    this.db.prepare("UPDATE highlights SET status = 'proposed', reject_reason = NULL WHERE id = ?").run(momentId);
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

const GAP_SET = "state = 'gap', clip_id = NULL, moment_id = NULL";
