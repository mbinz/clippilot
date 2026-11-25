import fs from 'node:fs/promises';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { StoryboardService, MomentWithSpeech, PanelNode } from '../storyboard/service.js';
import type { HighlightRepository } from '../../db/repositories/highlight.repository.js';
import { panelLabels } from './findings.js';
import { TranscriptRepository } from '../../db/repositories/transcript.repository.js';
import { transcriptSentences } from '../transcribe/speech.js';
import { renderStrip, stripNote, grabFrame, type FrameGrabber, type StripFrame } from './strips.js';

const round2 = (n: number) => Math.round(n * 100) / 100;

const SENTENCE_WINDOW_SEC = 3;
const MAX_ALTERNATIVES = 5;
const ALT_DESCRIPTION_MAX = 120;

export interface ContextSentence { start: number; end: number; text: string; in_moment: boolean }

export interface ContextAlternative {
  id: number;
  clip_file: string;
  start_sec: number;
  end_sec: number;
  tier: string;
  shot: string | null;
  role: string | null;
  description: string;
  jitter: MomentWithSpeech['jitter'];
  /** Shakes of high confidence inside the alternative's range. */
  high_shakes: number;
  in_dup_group: boolean;
}

export interface ContextMoment {
  id: number;
  clip_id: number;
  clip_file: string;
  clip_fps: number | null;
  /** The clip's own event (the scene's event is on the panel's `scene`). */
  clip_event: string | null;
  start_sec: number;
  end_sec: number;
  speed: number;
  slowmo: string;
  suggested_speed: number;
  played_sec: number;
  tier: string;
  shot: string | null;
  role: string | null;
  description: string;
  speech: string | null;
  speech_cut: MomentWithSpeech['speech_cut'];
  jitter: MomentWithSpeech['jitter'];
  /** Passed through from the storyboard JSON when moments carry `shakes` (null until the motion slice lands). */
  shakes: unknown;
  /** Shake fit (F1): clean | fixed | kept | null (not checked); `shake_note` = why it was kept. */
  shake_status: string | null;
  shake_note: string | null;
  motion: MomentWithSpeech['motion'];
  audio_keep: boolean;
  protected: boolean;
  protected_reasons: string[];
  dup_group: number | null;
  /** Other moments of the same duplicate group. */
  dup_alternatives: number[];
  /** Transcript sentences within 3 s of the moment (clip seconds); empty without a transcript. */
  sentences: ContextSentence[];
  /** Up to 5 similar / duplicate moments not yet used in the cut. */
  alternatives: ContextAlternative[];
}

export interface ContextPanel {
  panel_id: number;
  label: string;
  scene: { id: number; name: string; event: string | null };
  /** 1-based position within the scene. */
  position: number;
  intent: string;
  state: PanelNode['state'];
  source: PanelNode['source'];
  moment: ContextMoment | null;
  candidates: { id: number; clip_id: number; start_sec: number; end_sec: number; tier: string; description: string }[];
  /** True when the panel is the user's: placed by them, or its moment is protected. */
  protected: boolean;
  protected_reasons: string[];
  prev_panel_id: number | null;
  next_panel_id: number | null;
  strip: { path: string; frames: StripFrame[]; note?: string } | null;
  strip_error?: string;
}

export interface BriefCheck {
  target_sec: number;
  total_sec: number;
  delta_pct: number;
  must_have: { moment_id: number | null; text: string; in_cut: boolean | null; panel_id: number | null }[];
}

export interface CriticContext {
  cut: { id: number; name: string; brief_state: string; totals: unknown };
  brief: unknown;
  /** Target vs played length and whether the must-haves made it into the cut; null while the cut has no brief. */
  brief_check: BriefCheck | null;
  out_dir: string;
  panels: ContextPanel[];
}

/**
 * Everything the cut critic needs: the brief, every panel with its moment (range, speed, tags, speech, motion,
 * protection, alternatives, neighbours) and one still strip PNG per filled panel under `<outDir>/strips`.
 * `<outDir>/context.json` holds the same JSON this returns.
 */
export async function buildContext(
  svc: StoryboardService, hl: HighlightRepository, cutId: number, outDir: string,
  opts: { grab?: FrameGrabber; db?: Database.Database } = {},
): Promise<CriticContext> {
  const tree = svc.getCut(cutId);
  if (!tree) throw new Error(`Cut ${cutId} not found`);
  const labels = panelLabels(tree);
  const flat = tree.scenes.flatMap((s) => s.panels);
  const stripDir = path.join(outDir, 'strips');
  await fs.mkdir(stripDir, { recursive: true });

  const transcripts = opts.db ? new TranscriptRepository(opts.db) : null;
  const sentenceCache = new Map<number, { start: number; end: number; text: string }[]>();
  const sentencesOf = (clipId: number) => {
    if (!sentenceCache.has(clipId)) {
      const t = transcripts?.get(clipId);
      sentenceCache.set(clipId, t ? transcriptSentences(t.segments, t.words) : []);
    }
    return sentenceCache.get(clipId)!;
  };
  const clipEvent = (clipId: number): string | null => opts.db
    ? ((opts.db.prepare('SELECT e.name FROM clips c JOIN events e ON e.id = c.event_id WHERE c.id = ?').get(clipId) as { name: string } | undefined)?.name ?? null)
    : null;
  // Jitter band / shakes come from the same storyboard read as `cut show` (listMoments), once per project.
  const projectIds = new Set<number>();
  const used = new Set<number>();
  for (const p of flat) {
    if (p.state === 'filled' && p.moment) { used.add(p.moment.id); projectIds.add(svc.projectIdOfClip(p.moment.clip_id)); }
  }
  const pool = new Map<number, ReturnType<StoryboardService['listMoments']>[number]>();
  for (const pid of projectIds) for (const r of svc.listMoments(pid)) pool.set(r.id, r);
  const alternativesOf = (momentId: number, dups: number[]): ContextAlternative[] => {
    const ids = [...new Set([...svc.alternatives(momentId), ...dups])].filter((id) => id !== momentId && !used.has(id) && pool.has(id));
    return ids.slice(0, MAX_ALTERNATIVES).map((id) => {
      const r = pool.get(id)!;
      return {
        id, clip_file: svc.clipFileName(r.clip_id), start_sec: r.start_sec, end_sec: r.end_sec, tier: r.tier,
        shot: r.shot, role: r.role, description: r.description.slice(0, ALT_DESCRIPTION_MAX), jitter: r.jitter,
        high_shakes: (r.shakes ?? []).filter((s) => s.confidence === 'high').length,
        in_dup_group: dups.includes(id),
      };
    });
  };

  const panels: ContextPanel[] = [];
  for (const [si, scene] of tree.scenes.entries()) {
    for (const [pi, p] of scene.panels.entries()) {
      const i = flat.indexOf(p);
      const m = p.state === 'filled' ? p.moment : null;
      const reasons = m ? hl.protectionReasons(m.id) : [];
      const userPanel = p.source === 'user';
      const panel: ContextPanel = {
        panel_id: p.id, label: labels.get(p.id) ?? `S${si + 1}·P${pi + 1}`,
        scene: { id: scene.id, name: scene.name, event: scene.event?.name ?? null },
        position: pi + 1, intent: p.intent, state: p.state, source: p.source,
        moment: m && p.clip ? {
          id: m.id, clip_id: m.clip_id, clip_file: svc.clipFileName(m.clip_id),
          clip_fps: p.clip.fps, clip_event: clipEvent(m.clip_id), slowmo: m.slowmo, suggested_speed: m.suggested_speed,
          start_sec: m.start_sec, end_sec: m.end_sec, speed: m.speed, played_sec: round2((m.end_sec - m.start_sec) / m.speed),
          tier: m.user_tier ?? m.tier, shot: m.shot, role: m.role, description: m.description,
          speech: m.speech, speech_cut: m.speech_cut, jitter: m.jitter,
          shakes: (m as unknown as { shakes?: unknown }).shakes ?? null, motion: m.motion,
          shake_status: m.shake_status, shake_note: m.shake_note,
          audio_keep: m.audio_keep === 1, protected: reasons.length > 0, protected_reasons: reasons,
          dup_group: m.dup_group, dup_alternatives: hl.dupGroupMembers(m.id),
          sentences: sentencesOf(m.clip_id)
            .filter((s) => s.end > m.start_sec - SENTENCE_WINDOW_SEC && s.start < m.end_sec + SENTENCE_WINDOW_SEC)
            .map((s) => ({ start: s.start, end: s.end, text: s.text, in_moment: s.end > m.start_sec && s.start < m.end_sec })),
          alternatives: alternativesOf(m.id, hl.dupGroupMembers(m.id)),
        } : null,
        candidates: p.candidates.map((c) => ({
          id: c.id, clip_id: c.clip_id, start_sec: c.start_sec, end_sec: c.end_sec, tier: c.user_tier ?? c.tier, description: c.description,
        })),
        protected: userPanel || reasons.length > 0,
        protected_reasons: userPanel ? ['panel placed by user', ...reasons] : reasons,
        prev_panel_id: flat[i - 1]?.id ?? null, next_panel_id: flat[i + 1]?.id ?? null,
        strip: null,
      };
      if (m && p.clip) {
        try {
          const file = path.join(stripDir, `panel-${p.id}.png`);
          const frames = await renderStrip(p.clip.proxy_path ?? p.clip.file_path, m.start_sec, m.end_sec, p.clip.fps, file, opts.grab ?? grabFrame);
          panel.strip = { path: file, frames };
          const note = stripNote(m.start_sec, m.end_sec, p.clip.fps);
          if (note) panel.strip.note = note;
        } catch (err) {
          panel.strip_error = (err as Error).message;
        }
      }
      panels.push(panel);
    }
  }

  const brief = tree.brief as { target_sec?: number; must_have?: { moment_id?: number; text: string }[] } | null;
  const brief_check: BriefCheck | null = brief && typeof brief.target_sec === 'number' && brief.target_sec > 0 ? {
    target_sec: brief.target_sec, total_sec: tree.totals.duration_sec,
    delta_pct: Math.round(((tree.totals.duration_sec - brief.target_sec) / brief.target_sec) * 1000) / 10,
    must_have: (brief.must_have ?? []).map((h) => {
      if (h.moment_id === undefined) return { moment_id: null, text: h.text, in_cut: null, panel_id: null };
      const panel = flat.find((p) => p.state === 'filled' && p.moment_id === h.moment_id);
      return { moment_id: h.moment_id, text: h.text, in_cut: panel !== undefined, panel_id: panel?.id ?? null };
    }),
  } : null;
  const ctx: CriticContext = {
    cut: { id: tree.cut.id, name: tree.cut.name, brief_state: tree.brief_state, totals: tree.totals },
    brief: tree.brief, brief_check, out_dir: outDir, panels,
  };
  await fs.writeFile(path.join(outDir, 'context.json'), JSON.stringify(ctx, null, 2));
  return ctx;
}
