import fs from 'node:fs/promises';
import path from 'node:path';
import type { StoryboardService, MomentWithSpeech, PanelNode } from '../storyboard/service.js';
import type { HighlightRepository } from '../../db/repositories/highlight.repository.js';
import { panelLabels } from './findings.js';
import { renderStrip, grabFrame, type FrameGrabber, type StripFrame } from './strips.js';

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface ContextMoment {
  id: number;
  clip_id: number;
  clip_file: string;
  start_sec: number;
  end_sec: number;
  speed: number;
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
  motion: MomentWithSpeech['motion'];
  audio_keep: boolean;
  protected: boolean;
  protected_reasons: string[];
  dup_group: number | null;
  /** Other moments of the same duplicate group. */
  dup_alternatives: number[];
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
  strip: { path: string; frames: StripFrame[] } | null;
  strip_error?: string;
}

export interface CriticContext {
  cut: { id: number; name: string; brief_state: string; totals: unknown };
  brief: unknown;
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
  opts: { grab?: FrameGrabber } = {},
): Promise<CriticContext> {
  const tree = svc.getCut(cutId);
  if (!tree) throw new Error(`Cut ${cutId} not found`);
  const labels = panelLabels(tree);
  const flat = tree.scenes.flatMap((s) => s.panels);
  const stripDir = path.join(outDir, 'strips');
  await fs.mkdir(stripDir, { recursive: true });

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
          start_sec: m.start_sec, end_sec: m.end_sec, speed: m.speed, played_sec: round2((m.end_sec - m.start_sec) / m.speed),
          tier: m.user_tier ?? m.tier, shot: m.shot, role: m.role, description: m.description,
          speech: m.speech, speech_cut: m.speech_cut, jitter: m.jitter,
          shakes: (m as unknown as { shakes?: unknown }).shakes ?? null, motion: m.motion,
          audio_keep: m.audio_keep === 1, protected: reasons.length > 0, protected_reasons: reasons,
          dup_group: m.dup_group, dup_alternatives: hl.dupGroupMembers(m.id),
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
        } catch (err) {
          panel.strip_error = (err as Error).message;
        }
      }
      panels.push(panel);
    }
  }

  const ctx: CriticContext = {
    cut: { id: tree.cut.id, name: tree.cut.name, brief_state: tree.brief_state, totals: tree.totals },
    brief: tree.brief, out_dir: outDir, panels,
  };
  await fs.writeFile(path.join(outDir, 'context.json'), JSON.stringify(ctx, null, 2));
  return ctx;
}
