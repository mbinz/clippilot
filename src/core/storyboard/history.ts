import type Database from 'better-sqlite3';
import { defaultSpeed } from './range.js';

type Row = Record<string, unknown>;

/** Everything a board/CLI edit of one cut can change, with original row ids. */
export interface Snapshot {
  cut: { name: unknown; brief: unknown; brief_state: unknown };
  scenes: Row[];
  panels: Row[];
  candidates: Row[];
  /** Moments of the cut's project that differ from their default (status, range, speed or ★). */
  moments: MomentState[];
  hidden_clips: number[];
  /** Moments cut out of another one (`split_of`), full rows; absent in snapshots written before D1. */
  splits?: Row[];
}

export interface MomentState {
  id: number;
  status: string;
  reject_reason: string | null;
  start_sec: number;
  end_sec: number;
  speed: number;
  user_tier: string | null;
  /** AI range / AI speed (absent in snapshots written before D1; then left as they are). */
  ai_start_sec?: number;
  ai_end_sec?: number;
  ai_speed?: number | null;
}

export type Actor = 'ai' | 'user';

export interface OperationInfo {
  id: number;
  label: string;
  /** Who made the edit: Claude (`--ai`, draft apply, shake fix) or the user. */
  actor: Actor;
  undone: boolean;
  created_at: string;
}

export interface HistoryState {
  can_undo: boolean;
  can_redo: boolean;
  undo_label: string | null;
  redo_label: string | null;
}

type MomentDefaults = MomentState & { default_start: number; default_end: number; default_speed: number };

/** Every moment of the project with its state and the defaults it is compared against (analysis range, default speed). */
function momentRows(db: Database.Database, projectId: number): MomentDefaults[] {
  const rows = db.prepare(`SELECT h.id, h.status, h.reject_reason, h.start_sec, h.end_sec, h.speed, h.user_tier,
      h.ai_start_sec, h.ai_end_sec, h.ai_speed,
      COALESCE(h.ai_start_sec, h.start_sec) AS default_start, COALESCE(h.ai_end_sec, h.end_sec) AS default_end,
      h.suggested_speed, c.fps
    FROM highlights h JOIN clips c ON c.id = h.clip_id WHERE c.project_id = ? ORDER BY h.id`).all(projectId) as
    (Omit<MomentDefaults, 'default_speed'> & { suggested_speed: number; fps: number | null })[];
  return rows.map((r) => ({ ...r, default_speed: defaultSpeed(r.suggested_speed, r.fps) }));
}

const isEdited = (r: MomentDefaults): boolean => r.status !== 'proposed' || r.start_sec !== r.default_start
  || r.end_sec !== r.default_end || r.speed !== r.default_speed || r.user_tier !== null || r.ai_speed !== null;

/** Every moment of the project that differs from its default: status, range (vs the ai range), speed, AI speed or user tier. */
function editedMoments(db: Database.Database, projectId: number): MomentDefaults[] {
  return momentRows(db, projectId).filter(isEdited);
}

const stateOf = ({ id, status, reject_reason, start_sec, end_sec, speed, user_tier, ai_start_sec, ai_end_sec, ai_speed }: MomentDefaults): MomentState =>
  ({ id, status, reject_reason, start_sec, end_sec, speed, user_tier, ai_start_sec, ai_end_sec, ai_speed });

export function snapshot(db: Database.Database, cutId: number): Snapshot {
  const cut = db.prepare('SELECT name, brief, brief_state, project_id FROM stories WHERE id = ?').get(cutId) as
    (Snapshot['cut'] & { project_id: number }) | undefined;
  if (!cut) throw new Error(`Cut ${cutId} not found`);
  const all = (sql: string, ...p: unknown[]) => db.prepare(sql).all(...p) as Row[];
  return {
    cut: { name: cut.name, brief: cut.brief, brief_state: cut.brief_state },
    scenes: all('SELECT * FROM scenes WHERE story_id = ? ORDER BY position', cutId),
    panels: all('SELECT * FROM story_segments WHERE story_id = ? ORDER BY scene_id, position', cutId),
    candidates: all(`SELECT pc.* FROM panel_candidates pc JOIN story_segments p ON p.id = pc.panel_id
      WHERE p.story_id = ? ORDER BY pc.panel_id, pc.position`, cutId),
    moments: editedMoments(db, cut.project_id).map(stateOf),
    hidden_clips: (all('SELECT id FROM clips WHERE project_id = ? AND hidden = 1 ORDER BY id', cut.project_id) as { id: number }[])
      .map((r) => r.id),
    splits: splitRows(db, cut.project_id),
  };
}

function splitRows(db: Database.Database, projectId: number): Row[] {
  return db.prepare(`SELECT h.* FROM highlights h JOIN clips c ON c.id = h.clip_id
    WHERE c.project_id = ? AND h.split_of IS NOT NULL ORDER BY h.id`).all(projectId) as Row[];
}

function insertRows(db: Database.Database, table: string, rows: Row[]): void {
  for (const row of rows) {
    const cols = Object.keys(row);
    db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
      .run(...cols.map((c) => row[c]));
  }
}

/** Moments cut out of another one: those that did not exist at the snapshot are deleted (with panels still using them), missing ones are re-created. */
function restoreSplits(db: Database.Database, projectId: number, splits: Row[]): void {
  const want = new Set(splits.map((r) => r.id as number));
  const have = new Set(splitRows(db, projectId).map((r) => r.id as number));
  for (const id of have) {
    if (want.has(id)) continue;
    // Another cut's panel may use the sibling (a shake fit splits a moment in every cut that uses it): it goes with it.
    db.prepare('DELETE FROM story_segments WHERE moment_id = ?').run(id);
    db.prepare('DELETE FROM highlights WHERE id = ?').run(id);
  }
  insertRows(db, 'highlights', splits.filter((r) => !have.has(r.id as number)));
}

/** Rewrite the cut (and the project's moment statuses / hidden clips) to exactly the snapshot, in one transaction. */
export function restore(db: Database.Database, cutId: number, snap: Snapshot): void {
  db.transaction(() => {
    const cut = db.prepare('SELECT project_id FROM stories WHERE id = ?').get(cutId) as { project_id: number } | undefined;
    if (!cut) throw new Error(`Cut ${cutId} not found`);
    db.prepare("UPDATE stories SET name = ?, brief = ?, brief_state = ?, updated_at = datetime('now') WHERE id = ?")
      .run(snap.cut.name, snap.cut.brief, snap.cut.brief_state, cutId);

    db.prepare('DELETE FROM scenes WHERE story_id = ?').run(cutId); // cascades panels and candidates
    if (snap.splits) restoreSplits(db, cut.project_id, snap.splits);
    insertRows(db, 'scenes', snap.scenes);
    insertRows(db, 'story_segments', snap.panels);
    insertRows(db, 'panel_candidates', snap.candidates);

    // Every moment that is edited now goes back to its default; then the snapshot's edits are applied.
    const reset = db.prepare(`UPDATE highlights SET status = 'proposed', reject_reason = NULL, start_sec = ?, end_sec = ?,
      speed = ?, user_tier = NULL, ai_speed = NULL WHERE id = ?`);
    for (const m of editedMoments(db, cut.project_id)) reset.run(m.default_start, m.default_end, m.default_speed, m.id);
    const setMoment = db.prepare(`UPDATE highlights SET status = ?, reject_reason = ?, start_sec = ?, end_sec = ?,
      speed = ?, user_tier = ?, ai_start_sec = COALESCE(?, ai_start_sec), ai_end_sec = COALESCE(?, ai_end_sec), ai_speed = ?
      WHERE id = ?`);
    for (const m of snap.moments) {
      setMoment.run(m.status, m.reject_reason, m.start_sec, m.end_sec, m.speed, m.user_tier,
        m.ai_start_sec ?? null, m.ai_end_sec ?? null, m.ai_speed ?? null, m.id);
    }

    db.prepare('UPDATE clips SET hidden = 0 WHERE project_id = ? AND hidden = 1').run(cut.project_id);
    const hide = db.prepare('UPDATE clips SET hidden = 1 WHERE id = ?');
    for (const id of snap.hidden_clips) hide.run(id);
  })();
}

export function historyState(db: Database.Database, cutId: number): HistoryState {
  const undo = db.prepare('SELECT label FROM operations WHERE story_id = ? AND undone = 0 ORDER BY id DESC LIMIT 1')
    .get(cutId) as { label: string } | undefined;
  const redo = db.prepare('SELECT label FROM operations WHERE story_id = ? AND undone = 1 ORDER BY id ASC LIMIT 1')
    .get(cutId) as { label: string } | undefined;
  return { can_undo: !!undo, can_redo: !!redo, undo_label: undo?.label ?? null, redo_label: redo?.label ?? null };
}

/**
 * Run `fn` and log it as one operation (before/after snapshot); a new operation clears the redo stack.
 * Moments the operation changed are part of both snapshots even when they look unedited afterwards (an AI edit moves
 * the AI range along), so undo restores them exactly.
 */
export function command<T>(db: Database.Database, cutId: number, label: string, fn: () => T, opts: { actor?: Actor } = {}): T {
  return db.transaction(() => {
    const projectId = (db.prepare('SELECT project_id FROM stories WHERE id = ?').get(cutId) as { project_id: number } | undefined)?.project_id;
    const before = snapshot(db, cutId);
    const beforeAll = new Map(momentRows(db, projectId!).map((r) => [r.id, stateOf(r)]));
    const result = fn();
    const after = snapshot(db, cutId);
    const afterAll = new Map(momentRows(db, projectId!).map((r) => [r.id, stateOf(r)]));
    for (const id of new Set([...beforeAll.keys(), ...afterAll.keys()])) {
      const b = beforeAll.get(id);
      const a = afterAll.get(id);
      if (JSON.stringify(b) === JSON.stringify(a)) continue;
      if (b && !before.moments.some((m) => m.id === id)) before.moments.push(b);
      if (a && !after.moments.some((m) => m.id === id)) after.moments.push(a);
    }
    db.prepare('DELETE FROM operations WHERE story_id = ? AND undone = 1').run(cutId);
    db.prepare('INSERT INTO operations (story_id, label, "before", "after", actor) VALUES (?, ?, ?, ?, ?)')
      .run(cutId, label, JSON.stringify(before), JSON.stringify(after), opts.actor ?? 'user');
    return result;
  })();
}

type StepResult = { label: string } & Pick<HistoryState, 'can_undo' | 'can_redo'>;

export function undo(db: Database.Database, cutId: number): StepResult {
  return db.transaction(() => {
    const op = db.prepare('SELECT id, label, "before" AS snap FROM operations WHERE story_id = ? AND undone = 0 ORDER BY id DESC LIMIT 1')
      .get(cutId) as { id: number; label: string; snap: string } | undefined;
    if (!op) throw new Error('Nothing to undo');
    restore(db, cutId, JSON.parse(op.snap) as Snapshot);
    db.prepare('UPDATE operations SET undone = 1 WHERE id = ?').run(op.id);
    const s = historyState(db, cutId);
    return { label: op.label, can_undo: s.can_undo, can_redo: s.can_redo };
  })();
}

export function redo(db: Database.Database, cutId: number): StepResult {
  return db.transaction(() => {
    const op = db.prepare('SELECT id, label, "after" AS snap FROM operations WHERE story_id = ? AND undone = 1 ORDER BY id ASC LIMIT 1')
      .get(cutId) as { id: number; label: string; snap: string } | undefined;
    if (!op) throw new Error('Nothing to redo');
    restore(db, cutId, JSON.parse(op.snap) as Snapshot);
    db.prepare('UPDATE operations SET undone = 0 WHERE id = ?').run(op.id);
    const s = historyState(db, cutId);
    return { label: op.label, can_undo: s.can_undo, can_redo: s.can_redo };
  })();
}

export function history(db: Database.Database, cutId: number): OperationInfo[] {
  const rows = db.prepare('SELECT id, label, actor, undone, created_at FROM operations WHERE story_id = ? ORDER BY id DESC LIMIT 50')
    .all(cutId) as { id: number; label: string; actor: Actor; undone: number; created_at: string }[];
  return rows.map((r) => ({ ...r, undone: r.undone === 1 }));
}
