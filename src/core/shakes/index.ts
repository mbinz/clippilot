import type Database from 'better-sqlite3';
import type { Clip } from '../../types/clip.js';
import { HighlightRepository, type HighlightRecord, type ShakeStatus } from '../../db/repositories/highlight.repository.js';
import { MotionRepository } from '../../db/repositories/motion.repository.js';
import { TranscriptRepository } from '../../db/repositories/transcript.repository.js';
import { StoryboardService } from '../storyboard/service.js';
import { transcriptSentences } from '../transcribe/speech.js';
import { writeMomentColumns } from '../motion/index.js';
import { KEPT_NOTES, KEY_ACTION_NOTE, planShakeFix, type ShakePlan } from './plan.js';
import { askVerdict, buildShakePrompt, segmentBounds, type ShakeVerifier, type Verdict } from './verify.js';
import { shakeStateOf } from './state.js';
import path from 'node:path';
import { existsSync } from 'node:fs';

export { planShakeFix, type ShakePlan } from './plan.js';
export { shakeStateOf } from './state.js';
export type { ShakeVerifier } from './verify.js';

export interface FixOptions {
  projectId: number;
  /** Only the moments panels of this cut use. */
  cutId?: number;
  /** Only the moments of these clips. */
  clipIds?: number[];
  /** Plans only: no AI call, nothing written. */
  dryRun?: boolean;
  /** The AI check; without it trim / split plans are not applied. */
  verifier?: ShakeVerifier | null;
  exists?: (p: string) => boolean;
  onProgress?: (done: number, total: number) => void;
}

export interface MomentFix {
  moment_id: number;
  clip_id: number;
  /** What is (or, in a dry run, would be) stored; null = nothing decided (needs the AI check, or the check failed). */
  status: ShakeStatus | null;
  plan: ShakePlan;
  verdict: Verdict | null;
  reason: string | null;
  /** Moments created by a split. */
  new_moment_ids: number[];
  /** The edit was written (trim / split). */
  applied: boolean;
  error?: string;
}

export interface FixResult {
  moments: MomentFix[];
  totals: {
    /** Moments looked at in this run. */
    checked: number;
    clean: number;
    fixed: number;
    kept: number;
    /** Not decided: a trim / split plan without AI check (no verifier, or dry run). */
    unverified: number;
    /** Already checked for their current range. */
    skipped: number;
    /** Clip not measured yet. */
    unmeasured: number;
    errors: number;
    gemini_calls: number;
    new_moments: number;
  };
}

/**
 * F1 [shake fit] for the moments of a project (or of one cut): plan around every shake, let the AI check that the
 * moment's key action survives, then trim / split (unprotected AI moments, also those placed in a cut), or mark the
 * moment `kept`. Protected moments are never changed; they are marked `kept` when they contain a shake. A moment
 * whose range was checked already is not looked at again. Edits are one undo step per cut that uses a changed moment.
 */
export async function fixShakes(db: Database.Database, o: FixOptions): Promise<FixResult> {
  const hl = new HighlightRepository(db);
  const motion = new MotionRepository(db);
  const transcripts = new TranscriptRepository(db);
  const svc = new StoryboardService(db);
  const exists = o.exists ?? existsSync;
  const measured = new Set(motion.clipIdsWithCurve());
  const clipCache = new Map<number, Clip>();
  const clipOf = (id: number): Clip => {
    if (!clipCache.has(id)) clipCache.set(id, db.prepare('SELECT * FROM clips WHERE id = ?').get(id) as Clip);
    return clipCache.get(id)!;
  };

  const result: FixResult = { moments: [], totals: { checked: 0, clean: 0, fixed: 0, kept: 0, unverified: 0, skipped: 0, unmeasured: 0, errors: 0, gemini_calls: 0, new_moments: 0 } };
  const t = result.totals;

  let candidates: HighlightRecord[];
  if (o.cutId !== undefined) {
    const ids = db.prepare('SELECT DISTINCT moment_id FROM story_segments WHERE story_id = ? AND moment_id IS NOT NULL ORDER BY moment_id')
      .all(o.cutId) as { moment_id: number }[];
    candidates = ids.map((r) => hl.findById(r.moment_id)).filter((m): m is HighlightRecord => m !== undefined);
  } else {
    candidates = hl.listByProject(o.projectId);
  }
  candidates = candidates.filter((m) => m.status !== 'rejected' && !clipOf(m.clip_id).hidden && (!o.clipIds || o.clipIds.includes(m.clip_id)));

  const decisions: { fix: MomentFix; moment: HighlightRecord; plan: Extract<ShakePlan, { kind: 'trim' | 'split' }> }[] = [];
  let done = 0;
  for (const m of candidates) {
    o.onProgress?.(++done, candidates.length);
    if (shakeStateOf(m).shake_status !== null) { t.skipped++; continue; }
    if (!measured.has(m.clip_id)) { t.unmeasured++; continue; }
    const clip = clipOf(m.clip_id);
    const shakes = motion.getShakes(clip.id);
    const tr = transcripts.get(clip.id);
    const sentences = tr ? transcriptSentences(tr.segments, tr.words) : [];
    const range = { start: m.start_sec, end: m.end_sec };
    const plan = planShakeFix(range, shakes, sentences, { fps: clip.fps ?? 25 });
    t.checked++;
    const fix: MomentFix = { moment_id: m.id, clip_id: clip.id, status: null, plan, verdict: null, reason: null, new_moment_ids: [], applied: false };
    result.moments.push(fix);
    const decide = (status: ShakeStatus, note: string | null) => {
      fix.status = status;
      fix.reason = note;
      if (!o.dryRun) hl.setShakeStatus(m.id, status, note, m.start_sec, m.end_sec);
      t[status]++;
    };

    if (plan.kind === 'clean') { decide('clean', null); continue; }
    if (hl.protectionReasons(m.id).length > 0) { decide('kept', KEPT_NOTES.protected); continue; }
    if (m.jolt_at_key_action) { decide('kept', KEY_ACTION_NOTE); continue; }
    if (plan.kind === 'kept') { decide('kept', KEPT_NOTES[plan.reason]); continue; }
    if (o.dryRun || !o.verifier) { t.unverified++; continue; }

    try {
      const seg = segmentBounds(range, clip.duration_sec);
      const overlapping = shakes.filter((k) => k.end_sec > m.start_sec && k.start_sec < m.end_sec);
      const prompt = buildShakePrompt({ description: m.description, range, shakes: overlapping, parts: plan.parts, from: seg.from });
      t.gemini_calls++;
      const verdict = await askVerdict(o.verifier, { source: sourceOf(clip, exists), from: seg.from, to: seg.to, prompt });
      fix.verdict = verdict;
      if (verdict.keeps_content) decisions.push({ fix, moment: m, plan });
      else decide('kept', verdict.reason);
    } catch (err) {
      fix.error = err instanceof Error ? err.message : String(err);
      t.errors++;
    }
  }

  if (decisions.length > 0) applyDecisions(db, svc, hl, decisions, result);
  for (const clipId of new Set(decisions.filter((d) => d.fix.applied).map((d) => d.fix.clip_id))) {
    writeMomentColumns(clipId, { highlights: hl, motion });
  }
  return result;
}

function sourceOf(clip: Clip, exists: (p: string) => boolean): string {
  if (clip.proxy_path && exists(path.resolve(clip.proxy_path))) return path.resolve(clip.proxy_path);
  if (exists(clip.file_path)) return clip.file_path;
  throw new Error(`Neither the proxy nor the original of ${path.basename(clip.file_path)} is available`);
}

/** Write the accepted trims / splits; one history step "Shake fix (n moments)" per cut that uses a changed moment. */
function applyDecisions(
  db: Database.Database, svc: StoryboardService, hl: HighlightRepository,
  decisions: { fix: MomentFix; moment: HighlightRecord; plan: Extract<ShakePlan, { kind: 'trim' | 'split' }> }[],
  result: FixResult,
): void {
  const inCuts = db.prepare('SELECT DISTINCT story_id FROM story_segments WHERE moment_id = ?');
  const perCut = new Map<number, number>();
  for (const d of decisions) {
    for (const r of inCuts.all(d.moment.id) as { story_id: number }[]) perCut.set(r.story_id, (perCut.get(r.story_id) ?? 0) + 1);
  }
  const apply = () => {
    for (const { fix, moment, plan } of decisions) {
      try {
        const ids: number[] = [moment.id];
        if (plan.kind === 'trim') svc.trimMoment(moment.id, plan.parts[0].start, plan.parts[0].end, { ai: true });
        else ids.push(...svc.splitMoment(moment.id, plan.parts).sibling_ids);
        for (const id of ids) {
          const row = hl.findById(id)!;
          hl.setShakeStatus(id, 'fixed', null, row.start_sec, row.end_sec);
        }
        fix.status = 'fixed';
        fix.applied = true;
        fix.new_moment_ids = ids.slice(1);
        result.totals.fixed++;
        result.totals.new_moments += ids.length - 1;
      } catch (err) {
        fix.error = err instanceof Error ? err.message : String(err);
        result.totals.errors++;
      }
    }
  };
  let run = apply;
  for (const [cutId, n] of perCut) {
    const inner = run;
    run = () => { svc.command(cutId, `Shake fix (${n} ${n === 1 ? 'moment' : 'moments'})`, inner); };
  }
  run();
}
