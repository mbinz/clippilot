import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { resolveClippilotDir } from '../../utils/fs.js';
import { StoryboardService } from './service.js';

/** What the open board has selected. Board state, not an edit: never logged in `operations`. */
export interface BoardSelection {
  cut_id: number;
  scene_id: number;
  panel_id: number | null;
  moment_id: number | null;
  drawer: 'panel' | 'moment' | null;
  /** Moment previewed inside the panel drawer (an option clicked, not yet used). */
  preview_moment_id: number | null;
}

export type StoredBoardSelection = BoardSelection & { updated_at: string };

export class SelectionError extends Error {
  constructor(message: string, readonly status: 400 | 404) { super(message); }
}

export const selectionFile = (basePath: string): string =>
  path.join(resolveClippilotDir(basePath), 'board-selection.json');

const intOrNull = (v: unknown, what: string): number | null => {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new SelectionError(`${what} must be an integer or null`, 400);
  return v;
};

/** Validate the shape of a request body (not whether the ids exist). */
export function parseSelection(body: unknown): BoardSelection {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const cut = intOrNull(b.cut_id, 'cut_id');
  const scene = intOrNull(b.scene_id, 'scene_id');
  if (cut === null) throw new SelectionError('cut_id is required', 400);
  if (scene === null) throw new SelectionError('scene_id is required', 400);
  const drawer = b.drawer ?? null;
  if (drawer !== null && drawer !== 'panel' && drawer !== 'moment') throw new SelectionError("drawer must be 'panel', 'moment' or null", 400);
  return {
    cut_id: cut, scene_id: scene, panel_id: intOrNull(b.panel_id, 'panel_id'), moment_id: intOrNull(b.moment_id, 'moment_id'),
    drawer, preview_moment_id: intOrNull(b.preview_moment_id, 'preview_moment_id'),
  };
}

/** null when every id exists and belongs together; otherwise the status + message to answer with. */
export function checkSelection(db: Database.Database, s: BoardSelection): { status: 400 | 404; message: string } | null {
  const exists = (table: string, id: number) => db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id) !== undefined;
  if (!exists('stories', s.cut_id)) return { status: 404, message: `Cut ${s.cut_id} not found` };
  const scene = db.prepare('SELECT story_id FROM scenes WHERE id = ?').get(s.scene_id) as { story_id: number } | undefined;
  if (!scene) return { status: 404, message: `Scene ${s.scene_id} not found` };
  if (scene.story_id !== s.cut_id) return { status: 400, message: `Scene ${s.scene_id} is not in cut ${s.cut_id}` };
  if (s.panel_id !== null) {
    const panel = db.prepare('SELECT scene_id FROM story_segments WHERE id = ?').get(s.panel_id) as { scene_id: number } | undefined;
    if (!panel) return { status: 404, message: `Panel ${s.panel_id} not found` };
    if (panel.scene_id !== s.scene_id) return { status: 400, message: `Panel ${s.panel_id} is not in scene ${s.scene_id}` };
  }
  for (const [what, id] of [['Moment', s.moment_id], ['Preview moment', s.preview_moment_id]] as const) {
    if (id !== null && !exists('highlights', id)) return { status: 404, message: `${what} ${id} not found` };
  }
  return null;
}

/** Write atomically (temp file + rename) so a reader never sees half a file. */
export function writeBoardSelection(basePath: string, s: BoardSelection): StoredBoardSelection {
  const file = selectionFile(basePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const stored: StoredBoardSelection = { ...s, updated_at: new Date().toISOString() };
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(stored, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
  return stored;
}

/** The stored selection, or null when there is none (or the file is unreadable). */
export function readBoardSelection(basePath: string): StoredBoardSelection | null {
  try {
    const raw = JSON.parse(fs.readFileSync(selectionFile(basePath), 'utf-8')) as StoredBoardSelection;
    return raw && typeof raw === 'object' ? raw : null;
  } catch {
    return null;
  }
}

export interface ContextMoment {
  id: number;
  /** Why this moment is the focus: the previewed one, the panel's, or the one in the moment drawer. */
  focus: 'preview' | 'panel' | 'drawer';
  clip: { id: number; file_path: string; file_name: string };
  start_sec: number;
  end_sec: number;
  speed: number;
  /** Effective tier (the user's ★ override, else the AI tier). */
  tier: string;
  shot: string | null;
  role: string | null;
  description: string;
  status: string;
  /** Ids of similar moments (same event + role + shot), ★ first, then recording time. */
  alternatives: number[];
}

export interface BoardContext {
  updated_at: string | null;
  /** True when some selected id no longer exists (deleted since the selection was written). */
  stale: boolean;
  cut: { id: number; name: string } | null;
  scene: { id: number; name: string; position: number; event: { id: number; name: string } | null } | null;
  panel: { id: number; number: number; intent: string; state: string; source: string; moment_id: number | null; candidates: number[] } | null;
  drawer: 'panel' | 'moment' | null;
  preview_moment_id: number | null;
  moment: ContextMoment | null;
}

/** Resolve a stored selection against the DB; ids that no longer exist resolve to null and set `stale`. */
export function resolveBoardContext(
  db: Database.Database,
  s: BoardSelection & { updated_at?: string },
): BoardContext {
  const alternatives = (momentId: number) => new StoryboardService(db).alternatives(momentId);
  let stale = false;
  const miss = <T>(v: T | undefined | null): T | null => { if (v == null) { stale = true; return null; } return v; };

  const cut = miss(db.prepare('SELECT id, name FROM stories WHERE id = ?').get(s.cut_id) as { id: number; name: string } | undefined);
  const sceneRow = miss(db.prepare(`SELECT s.id, s.name, s.position, s.event_id, e.name AS event_name
    FROM scenes s LEFT JOIN events e ON e.id = s.event_id WHERE s.id = ?`).get(s.scene_id) as
    { id: number; name: string; position: number; event_id: number | null; event_name: string | null } | undefined);

  let panel: BoardContext['panel'] = null;
  if (s.panel_id !== null) {
    const p = miss(db.prepare('SELECT id, scene_id, intent, state, source, moment_id FROM story_segments WHERE id = ?').get(s.panel_id) as
      { id: number; scene_id: number; intent: string; state: string; source: string; moment_id: number | null } | undefined);
    if (p) {
      const siblings = db.prepare('SELECT id FROM story_segments WHERE scene_id = ? ORDER BY position').all(p.scene_id) as { id: number }[];
      const candidates = (db.prepare('SELECT moment_id FROM panel_candidates WHERE panel_id = ? ORDER BY position').all(p.id) as { moment_id: number }[])
        .map((r) => r.moment_id);
      const momentId = p.state === 'filled' ? p.moment_id : p.state === 'candidates' ? candidates[0] ?? null : null;
      panel = {
        id: p.id, number: siblings.findIndex((x) => x.id === p.id) + 1, intent: p.intent, state: p.state, source: p.source,
        moment_id: momentId, candidates,
      };
    }
  }

  const momentExists = (id: number | null): number | null =>
    id === null ? null : db.prepare('SELECT 1 FROM highlights WHERE id = ?').get(id) ? id : (stale = true, null);
  const previewId = momentExists(s.preview_moment_id);
  const drawerId = momentExists(s.moment_id);
  const focus: [number | null, ContextMoment['focus']][] = [[previewId, 'preview'], [panel?.moment_id ?? null, 'panel'], [drawerId, 'drawer']];
  const picked = focus.find(([id]) => id !== null);

  return {
    updated_at: s.updated_at ?? null,
    stale,
    cut,
    scene: sceneRow && {
      id: sceneRow.id, name: sceneRow.name, position: sceneRow.position,
      event: sceneRow.event_id === null ? null : { id: sceneRow.event_id, name: sceneRow.event_name ?? '' },
    },
    panel,
    drawer: s.drawer,
    preview_moment_id: s.preview_moment_id,
    moment: picked ? momentDetail(db, picked[0]!, picked[1], alternatives) : null,
  };
}

function momentDetail(
  db: Database.Database, id: number, focus: ContextMoment['focus'], alternatives: (id: number) => number[],
): ContextMoment | null {
  const r = db.prepare(`SELECT h.id, h.clip_id, h.start_sec, h.end_sec, h.speed, h.tier, h.user_tier, h.shot, h.role,
      h.description, h.status, c.file_path FROM highlights h JOIN clips c ON c.id = h.clip_id WHERE h.id = ?`).get(id) as
    { id: number; clip_id: number; start_sec: number; end_sec: number; speed: number; tier: string; user_tier: string | null;
      shot: string | null; role: string | null; description: string; status: string; file_path: string } | undefined;
  if (!r) return null;
  return {
    id: r.id, focus, clip: { id: r.clip_id, file_path: r.file_path, file_name: path.basename(r.file_path) },
    start_sec: r.start_sec, end_sec: r.end_sec, speed: r.speed, tier: r.user_tier ?? r.tier, shot: r.shot, role: r.role,
    description: r.description, status: r.status, alternatives: alternatives(id),
  };
}
