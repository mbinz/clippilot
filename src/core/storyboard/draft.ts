import type Database from 'better-sqlite3';
import type { Clip } from '../../types/clip.js';
import type { HighlightRecord } from '../../db/repositories/highlight.repository.js';
import { speedAllowed } from '../analyze/highlights.js';
import { BriefSchema, DraftSchema, DraftValidationError, formatIssues, type Draft } from './schema.js';
import { MIN_CUT_PART_SEC, MIN_PANEL_SEC, type StoryboardService } from './service.js';
import { HighlightRepository } from '../../db/repositories/highlight.repository.js';
import { draftWarnings, type DraftWarning } from './rules.js';

export const KEPT_SCENE_NAME = 'Kept';
const SPEEDS = [1, 0.5, 0.25];

/** Validate the whole draft against the database and return every problem. */
export function validateDraft(db: Database.Database, projectId: number | null, draft: Draft): string[] {
  const errors: string[] = [];
  const momentStmt = db.prepare('SELECT * FROM highlights WHERE id = ?');
  const clipStmt = db.prepare('SELECT * FROM clips WHERE id = ?');

  /** Returns the moment with its clip when usable; records the reason otherwise. */
  const usable = (where: string, id: number): { m: HighlightRecord; clip: Clip } | null => {
    const m = momentStmt.get(id) as HighlightRecord | undefined;
    if (!m) { errors.push(`${where}: moment ${id} not found`); return null; }
    const clip = clipStmt.get(m.clip_id) as Clip;
    if (clip.project_id !== projectId) { errors.push(`${where}: moment ${id} belongs to another project`); return null; }
    if (m.status === 'rejected') { errors.push(`${where}: moment ${id} is rejected`); return null; }
    if (clip.hidden) { errors.push(`${where}: moment ${id} is on a hidden clip`); return null; }
    return { m, clip };
  };

  const repo = new HighlightRepository(db);
  draft.scenes.forEach((scene, si) => {
    if (scene.event_id !== undefined) {
      const ev = db.prepare('SELECT project_id FROM events WHERE id = ?').get(scene.event_id) as { project_id: number } | undefined;
      if (!ev || ev.project_id !== projectId) errors.push(`scenes.${si}.event_id: event ${scene.event_id} not found in this project`);
    }
    scene.panels.forEach((panel, pi) => {
      const where = `scenes.${si}.panels.${pi}`;
      if (panel.cut_out && panel.moment_id === undefined) errors.push(`${where}.cut_out: needs a moment_id`);
      if (panel.candidates) {
        if (new Set(panel.candidates).size !== panel.candidates.length) errors.push(`${where}.candidates: duplicate moment ids`);
        for (const id of new Set(panel.candidates)) usable(`${where}.candidates`, id);
      }
      if (panel.moment_id === undefined) return;
      const found = usable(`${where}.moment_id`, panel.moment_id);
      if (!found) return;
      const start = panel.start_sec ?? found.m.start_sec;
      const end = panel.end_sec ?? found.m.end_sec;
      if (start < 0 || end > found.clip.duration_sec) {
        errors.push(`${where}: range ${start}-${end} is outside the clip duration (${found.clip.duration_sec} s)`);
      } else if (end - start < MIN_PANEL_SEC) {
        errors.push(`${where}: range ${start}-${end} is shorter than ${MIN_PANEL_SEC} s`);
      }
      if (panel.cut_out) {
        const reasons = repo.protectionReasons(found.m.id);
        const [from, to] = panel.cut_out;
        if (reasons.length) errors.push(`${where}.cut_out: moment ${found.m.id} is protected (${reasons.join(', ')}); only you can change it`);
        else if (from < start || to > end) errors.push(`${where}.cut_out: ${from}-${to} must be inside the moment range ${start}-${end}`);
        else if (to <= from) errors.push(`${where}.cut_out: must start before it ends`);
        else if (from - start < MIN_CUT_PART_SEC - 1e-9) errors.push(`${where}.cut_out: must leave at least ${MIN_CUT_PART_SEC} s before the cut`);
        else if (end - to < MIN_CUT_PART_SEC - 1e-9) errors.push(`${where}.cut_out: must leave at least ${MIN_CUT_PART_SEC} s after the cut`);
      }
      if (panel.speed !== undefined) {
        if (!SPEEDS.includes(panel.speed)) errors.push(`${where}: invalid speed ${panel.speed} (use 1, 0.5 or 0.25)`);
        else if (!speedAllowed(panel.speed, found.clip.fps)) errors.push(`${where}: speed ${panel.speed} needs a higher fps (clip is ${found.clip.fps ?? 'unknown'} fps)`);
      }
    });
  });
  return errors;
}

/**
 * Apply a draft to a cut in one transaction. `replace` swaps scenes and AI panels for the draft but keeps
 * panels the user touched (source user), re-appended to the same-named scene or to a trailing "Kept" scene.
 */
export function applyDraft(
  db: Database.Database,
  svc: StoryboardService,
  cutId: number,
  raw: unknown,
  opts: { mode: 'replace' | 'append' },
): { scenes: number; panels: number; warnings: DraftWarning[] } {
  const cut = svc.getCut(cutId);
  if (!cut) throw new Error(`Cut ${cutId} not found`);
  const parsed = DraftSchema.safeParse(raw);
  if (!parsed.success) throw new DraftValidationError(formatIssues(parsed.error));
  const draft = parsed.data;
  const errors = validateDraft(db, cut.cut.project_id, draft);
  if (errors.length) throw new DraftValidationError(errors);

  return db.transaction(() => {
    const oldScenes = cut.scenes;
    const kept: { sceneName: string; id: number }[] = [];
    if (opts.mode === 'replace') {
      for (const scene of oldScenes) {
        for (const p of scene.panels) {
          if (p.source === 'user') kept.push({ sceneName: scene.name, id: p.id });
          else svc.deletePanel(p.id);
        }
      }
    }

    let panels = 0;
    const created = new Map<string, number>();
    for (const sd of draft.scenes) {
      const scene = svc.addScene(cutId, sd.name);
      if (sd.event_id !== undefined) svc.setSceneEvent(scene.id, sd.event_id);
      if (sd.notes !== undefined) db.prepare('UPDATE scenes SET notes = ? WHERE id = ?').run(sd.notes, scene.id);
      if (!created.has(sd.name)) created.set(sd.name, scene.id);
      for (const pd of sd.panels) {
        const panel = svc.addPanel(scene.id, {
          intent: pd.intent, momentId: pd.moment_id, candidates: pd.candidates,
          startSec: pd.start_sec, endSec: pd.end_sec, speed: pd.speed, source: 'ai',
        });
        panels++;
        if (pd.cut_out) {
          panels += svc.cutOutMoment(pd.moment_id!, pd.cut_out[0], pd.cut_out[1], { ai: true, cutId, panelId: panel.id }).panels.length;
        }
      }
    }

    if (opts.mode === 'replace') {
      let keptScene: number | null = null;
      for (const k of kept) {
        let target = created.get(k.sceneName);
        if (target === undefined) {
          keptScene ??= svc.addScene(cutId, KEPT_SCENE_NAME).id;
          target = keptScene;
        }
        svc.movePanel(k.id, target, Number.MAX_SAFE_INTEGER);
        panels++;
      }
      for (const scene of oldScenes) svc.deleteScene(scene.id);
    }
    const brief = cut.brief ? BriefSchema.safeParse(cut.brief) : null;
    const warnings = draftWarnings(draft, svc.listMoments(cut.cut.project_id), brief?.success ? brief.data : null);
    return { scenes: draft.scenes.length, panels, warnings };
  })();
}
