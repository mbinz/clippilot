import { describe, it, expect, beforeEach } from 'vitest';
import { setup } from './_helpers.js';

describe('undo / redo (operation log)', () => {
  let t: ReturnType<typeof setup>;
  let cutId: number;
  let clipA: number;
  let ma: number[];
  const svc = () => t.svc;
  const panelsOf = () => svc().getCut(cutId)!.scenes.flatMap((s) => s.panels);

  beforeEach(() => {
    t = setup();
    cutId = t.svc.createCut(t.projectId, 'Main').id;
    clipA = t.addClip({ fps: 60 }).id;
    ma = t.addMoments(clipA, [{ start_sec: 2, end_sec: 6 }, { start_sec: 10, end_sec: 14 }]);
  });

  it('place: undo restores the gap and the moment status, redo re-applies', () => {
    const scene = svc().addScene(cutId, 'A');
    const panel = svc().addPanel(scene.id, { intent: 'wave' });
    svc().command(cutId, 'Place moment in panel 1', () => svc().placeMoment(panel.id, ma[0]));
    expect(panelsOf()[0].state).toBe('filled');

    const u = svc().undo(cutId);
    expect(u).toEqual({ label: 'Place moment in panel 1', can_undo: false, can_redo: true });
    expect(panelsOf()[0]).toMatchObject({ id: panel.id, state: 'gap', clip_id: null });
    expect(t.db.prepare('SELECT status FROM highlights WHERE id = ?').get(ma[0])).toEqual({ status: 'proposed' });

    const r = svc().redo(cutId);
    expect(r).toEqual({ label: 'Place moment in panel 1', can_undo: true, can_redo: false });
    expect(panelsOf()[0]).toMatchObject({ id: panel.id, state: 'filled', moment_id: ma[0] });
    expect(t.db.prepare('SELECT status FROM highlights WHERE id = ?').get(ma[0])).toEqual({ status: 'confirmed' });
  });

  it('trim round-trip', () => {
    const scene = svc().addScene(cutId, 'A');
    const panel = svc().addPanel(scene.id, { momentId: ma[0] });
    svc().command(cutId, 'Trim panel', () => svc().trimPanel(panel.id, 3, 5));
    expect(panelsOf()[0]).toMatchObject({ start_sec: 3, end_sec: 5 });
    svc().undo(cutId);
    expect(panelsOf()[0]).toMatchObject({ start_sec: 2, end_sec: 6 });
    svc().redo(cutId);
    expect(panelsOf()[0]).toMatchObject({ start_sec: 3, end_sec: 5 });
  });

  it('reject: undo brings back status, reason, candidates and the filled panel', () => {
    const scene = svc().addScene(cutId, 'A');
    const cands = svc().addPanel(scene.id, { candidates: [ma[0], ma[1]] });
    const filled = svc().addPanel(scene.id, { momentId: ma[0] });
    svc().command(cutId, '👎 shake', () => svc().rejectMoment(ma[0], 'shake'));
    expect(panelsOf().find((p) => p.id === filled.id)!.state).toBe('gap');
    expect(panelsOf().find((p) => p.id === cands.id)!.candidates.map((m) => m.id)).toEqual([ma[1]]);

    svc().undo(cutId);
    expect(panelsOf().find((p) => p.id === filled.id)).toMatchObject({ state: 'filled', moment_id: ma[0] });
    expect(panelsOf().find((p) => p.id === cands.id)!.candidates.map((m) => m.id)).toEqual([ma[0], ma[1]]);
    expect(t.db.prepare('SELECT status, reject_reason FROM highlights WHERE id = ?').get(ma[0]))
      .toEqual({ status: 'proposed', reject_reason: null });

    svc().redo(cutId);
    expect(t.db.prepare('SELECT status, reject_reason FROM highlights WHERE id = ?').get(ma[0]))
      .toEqual({ status: 'rejected', reject_reason: 'shake' });
  });

  it('hide clip: undo unhides the clip and restores panels', () => {
    const scene = svc().addScene(cutId, 'A');
    const panel = svc().addPanel(scene.id, { momentId: ma[0] });
    svc().command(cutId, 'Hide clip c1.mp4', () => svc().hideClip(clipA));
    expect(panelsOf()[0].state).toBe('gap');
    svc().undo(cutId);
    expect(t.db.prepare('SELECT hidden FROM clips WHERE id = ?').get(clipA)).toEqual({ hidden: 0 });
    expect(panelsOf()[0]).toMatchObject({ id: panel.id, state: 'filled' });
    svc().redo(cutId);
    expect(t.db.prepare('SELECT hidden FROM clips WHERE id = ?').get(clipA)).toEqual({ hidden: 1 });
  });

  it('delete scene: undo brings back scene and panel ids, candidates and order', () => {
    const s1 = svc().addScene(cutId, 'One');
    const s2 = svc().addScene(cutId, 'Two');
    const p1 = svc().addPanel(s2.id, { candidates: [ma[0], ma[1]], intent: 'x' });
    const p2 = svc().addPanel(s2.id, { momentId: ma[1] });
    const before = svc().getCut(cutId)!;
    svc().command(cutId, 'Delete scene', () => svc().deleteScene(s2.id));
    expect(svc().getCut(cutId)!.scenes.map((s) => s.id)).toEqual([s1.id]);
    svc().undo(cutId);
    const after = svc().getCut(cutId)!;
    expect(after.scenes.map((s) => s.id)).toEqual([s1.id, s2.id]);
    expect(after.scenes[1].panels.map((p) => p.id)).toEqual([p1.id, p2.id]);
    expect(after).toEqual(before);
  });

  it('brief changes are undoable', () => {
    const brief = { target_sec: 60, audience: 'a', mood: 'm', must_have: [], ending: 'e' };
    svc().command(cutId, 'Set brief', () => svc().setBrief(cutId, brief, 'proposed'));
    expect(svc().getCut(cutId)!.brief_state).toBe('proposed');
    svc().undo(cutId);
    expect(svc().getCut(cutId)).toMatchObject({ brief: null, brief_state: 'none' });
  });

  it('applyDraft is one operation', () => {
    const draft = {
      scenes: [
        { name: 'A', panels: [{ intent: 'a', moment_id: ma[0] }, { intent: 'b' }] },
        { name: 'B', panels: [{ intent: 'c', candidates: [ma[0], ma[1]] }] },
      ],
    };
    svc().command(cutId, 'Apply draft (3 panels)', () => svc().applyDraft(cutId, draft, { mode: 'replace' }));
    expect(svc().history(cutId)).toHaveLength(1);
    expect(panelsOf()).toHaveLength(3);
    svc().undo(cutId);
    expect(svc().getCut(cutId)!.scenes).toEqual([]);
    expect(svc().history(cutId)[0].undone).toBe(true);
    svc().redo(cutId);
    expect(panelsOf()).toHaveLength(3);
  });

  it('a new action clears redo; undo walks back several steps', () => {
    const scene = svc().addScene(cutId, 'A');
    const panel = svc().addPanel(scene.id, {});
    svc().command(cutId, 'one', () => svc().setIntent(panel.id, 'one'));
    svc().command(cutId, 'two', () => svc().setIntent(panel.id, 'two'));
    svc().undo(cutId);
    expect(svc().historyState(cutId)).toEqual({ can_undo: true, can_redo: true, undo_label: 'one', redo_label: 'two' });
    svc().command(cutId, 'three', () => svc().setIntent(panel.id, 'three'));
    expect(svc().historyState(cutId)).toMatchObject({ can_redo: false, redo_label: null, undo_label: 'three' });
    expect(() => svc().redo(cutId)).toThrow(/Nothing to redo/);
    svc().undo(cutId);
    svc().undo(cutId);
    expect(panelsOf()[0].intent).toBe('');
  });

  it('history lists the newest 50 with label, undone and created_at', () => {
    const scene = svc().addScene(cutId, 'A');
    const panel = svc().addPanel(scene.id, {});
    for (let i = 0; i < 55; i++) svc().command(cutId, `op ${i}`, () => svc().setIntent(panel.id, `i${i}`));
    const h = svc().history(cutId);
    expect(h).toHaveLength(50);
    expect(h[0]).toMatchObject({ label: 'op 54', undone: false });
    expect(typeof h[0].created_at).toBe('string');
    expect(typeof h[0].id).toBe('number');
  });

  it('empty history: undo and redo error', () => {
    expect(() => svc().undo(cutId)).toThrow(/Nothing to undo/);
    expect(() => svc().redo(cutId)).toThrow(/Nothing to redo/);
    expect(svc().historyState(cutId)).toEqual({ can_undo: false, can_redo: false, undo_label: null, redo_label: null });
  });

  it('a failing command rolls back and logs nothing', () => {
    const scene = svc().addScene(cutId, 'A');
    const panel = svc().addPanel(scene.id, {});
    expect(() => svc().command(cutId, 'bad', () => {
      svc().setIntent(panel.id, 'changed');
      throw new Error('boom');
    })).toThrow('boom');
    expect(panelsOf()[0].intent).toBe('');
    expect(svc().history(cutId)).toEqual([]);
  });

  it('operations are removed with the cut', () => {
    svc().command(cutId, 'x', () => svc().renameCut(cutId, 'Y'));
    svc().deleteCut(cutId);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM operations').get()).toEqual({ n: 0 });
  });
});
