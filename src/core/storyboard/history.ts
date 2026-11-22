import type Database from 'better-sqlite3';

type Row = Record<string, unknown>;

/** Everything a board/CLI edit of one cut can change, with original row ids. */
export interface Snapshot {
  cut: { name: unknown; brief: unknown; brief_state: unknown };
  scenes: Row[];
  panels: Row[];
  candidates: Row[];
  /** Non-proposed moments of the cut's project. */
  moments: { id: number; status: string; reject_reason: string | null }[];
  hidden_clips: number[];
}

export interface OperationInfo {
  id: number;
  label: string;
  undone: boolean;
  created_at: string;
}

export interface HistoryState {
  can_undo: boolean;
  can_redo: boolean;
  undo_label: string | null;
  redo_label: string | null;
}

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
    moments: all(`SELECT h.id, h.status, h.reject_reason FROM highlights h JOIN clips c ON c.id = h.clip_id
      WHERE c.project_id = ? AND h.status <> 'proposed' ORDER BY h.id`, cut.project_id) as Snapshot['moments'],
    hidden_clips: (all('SELECT id FROM clips WHERE project_id = ? AND hidden = 1 ORDER BY id', cut.project_id) as { id: number }[])
      .map((r) => r.id),
  };
}

function insertRows(db: Database.Database, table: string, rows: Row[]): void {
  for (const row of rows) {
    const cols = Object.keys(row);
    db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
      .run(...cols.map((c) => row[c]));
  }
}

/** Rewrite the cut (and the project's moment statuses / hidden clips) to exactly the snapshot, in one transaction. */
export function restore(db: Database.Database, cutId: number, snap: Snapshot): void {
  db.transaction(() => {
    const cut = db.prepare('SELECT project_id FROM stories WHERE id = ?').get(cutId) as { project_id: number } | undefined;
    if (!cut) throw new Error(`Cut ${cutId} not found`);
    db.prepare("UPDATE stories SET name = ?, brief = ?, brief_state = ?, updated_at = datetime('now') WHERE id = ?")
      .run(snap.cut.name, snap.cut.brief, snap.cut.brief_state, cutId);

    db.prepare('DELETE FROM scenes WHERE story_id = ?').run(cutId); // cascades panels and candidates
    insertRows(db, 'scenes', snap.scenes);
    insertRows(db, 'story_segments', snap.panels);
    insertRows(db, 'panel_candidates', snap.candidates);

    db.prepare(`UPDATE highlights SET status = 'proposed', reject_reason = NULL
      WHERE status <> 'proposed' AND clip_id IN (SELECT id FROM clips WHERE project_id = ?)`).run(cut.project_id);
    const setMoment = db.prepare('UPDATE highlights SET status = ?, reject_reason = ? WHERE id = ?');
    for (const m of snap.moments) setMoment.run(m.status, m.reject_reason, m.id);

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

/** Run `fn` and log it as one operation (before/after snapshot); a new operation clears the redo stack. */
export function command<T>(db: Database.Database, cutId: number, label: string, fn: () => T): T {
  return db.transaction(() => {
    const before = snapshot(db, cutId);
    const result = fn();
    const after = snapshot(db, cutId);
    db.prepare('DELETE FROM operations WHERE story_id = ? AND undone = 1').run(cutId);
    db.prepare('INSERT INTO operations (story_id, label, "before", "after") VALUES (?, ?, ?, ?)')
      .run(cutId, label, JSON.stringify(before), JSON.stringify(after));
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
  const rows = db.prepare('SELECT id, label, undone, created_at FROM operations WHERE story_id = ? ORDER BY id DESC LIMIT 50')
    .all(cutId) as { id: number; label: string; undone: number; created_at: string }[];
  return rows.map((r) => ({ ...r, undone: r.undone === 1 }));
}
