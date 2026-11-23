import { describe, it, expect, beforeEach } from 'vitest';
import { setup } from './_helpers.js';

describe('StoryboardService', () => {
  let t: ReturnType<typeof setup>;
  let cutId: number;
  beforeEach(() => {
    t = setup();
    cutId = t.svc.createCut(t.projectId, 'Cut A').id;
  });

  const positions = (sceneId: number) =>
    (t.db.prepare('SELECT position FROM story_segments WHERE scene_id = ? ORDER BY position').all(sceneId) as { position: number }[])
      .map((r) => r.position);
  const scenePositions = () =>
    (t.db.prepare('SELECT position FROM scenes WHERE story_id = ? ORDER BY position').all(cutId) as { position: number }[])
      .map((r) => r.position);

  describe('cuts', () => {
    it('creates, renames, lists and deletes', () => {
      const b = t.svc.createCut(t.projectId, 'B');
      expect(t.svc.listCuts(t.projectId).map((c) => c.name).sort()).toEqual(['B', 'Cut A']);
      t.svc.renameCut(b.id, 'B2');
      expect(t.svc.getCut(b.id)!.cut.name).toBe('B2');
      t.svc.deleteCut(b.id);
      expect(t.svc.getCut(b.id)).toBeNull();
    });

    it('getOrCreateMainCut creates "Main" once and returns it afterwards', () => {
      const a = t.svc.getOrCreateMainCut(t.projectId);
      expect(a.name).toBe('Main');
      expect(t.svc.getOrCreateMainCut(t.projectId).id).toBe(a.id);
      expect(t.svc.listCuts(t.projectId).filter((c) => c.name === 'Main')).toHaveLength(1);
    });

    it('getOrCreateMainCut ignores other projects', () => {
      const other = t.db.prepare("INSERT INTO projects (name) VALUES ('q')").run().lastInsertRowid as number;
      const a = t.svc.getOrCreateMainCut(t.projectId);
      expect(t.svc.getOrCreateMainCut(other).id).not.toBe(a.id);
    });
  });

  describe('scenes', () => {
    it('adds at end and at a position, keeping positions dense', () => {
      const a = t.svc.addScene(cutId, 'A');
      const b = t.svc.addScene(cutId, 'B');
      const c = t.svc.addScene(cutId, 'C', { position: 0 });
      expect(t.svc.getCut(cutId)!.scenes.map((s) => s.name)).toEqual(['C', 'A', 'B']);
      expect(scenePositions()).toEqual([0, 1, 2]);
      expect([a.id, b.id, c.id]).toHaveLength(3);
    });

    it('renames, moves, deletes (dense) and sets the event', () => {
      const a = t.svc.addScene(cutId, 'A');
      t.svc.addScene(cutId, 'B');
      const c = t.svc.addScene(cutId, 'C');
      t.svc.moveScene(c.id, 0);
      expect(t.svc.getCut(cutId)!.scenes.map((s) => s.name)).toEqual(['C', 'A', 'B']);
      t.svc.renameScene(a.id, 'A2');
      t.svc.deleteScene(c.id);
      expect(t.svc.getCut(cutId)!.scenes.map((s) => s.name)).toEqual(['A2', 'B']);
      expect(scenePositions()).toEqual([0, 1]);

      const ev = t.db.prepare("INSERT INTO events (project_id, name, source) VALUES (?, 'Beach', 'folder')").run(t.projectId).lastInsertRowid as number;
      t.svc.setSceneEvent(a.id, ev);
      expect(t.svc.getCut(cutId)!.scenes[0].event).toMatchObject({ id: ev, name: 'Beach' });
      t.svc.setSceneEvent(a.id, null);
      expect(t.svc.getCut(cutId)!.scenes[0].event).toBeNull();
    });

    it('move clamps out-of-range positions', () => {
      const a = t.svc.addScene(cutId, 'A');
      t.svc.addScene(cutId, 'B');
      t.svc.moveScene(a.id, 99);
      expect(t.svc.getCut(cutId)!.scenes.map((s) => s.name)).toEqual(['B', 'A']);
    });
  });

  describe('panels', () => {
    let sceneA: number;
    let sceneB: number;
    beforeEach(() => {
      sceneA = t.svc.addScene(cutId, 'A').id;
      sceneB = t.svc.addScene(cutId, 'B').id;
    });

    it('adds a gap panel', () => {
      const p = t.svc.addPanel(sceneA, { intent: 'arrival' });
      expect(p).toMatchObject({ state: 'gap', intent: 'arrival', source: 'ai', clip_id: null, moment_id: null, position: 0 });
    });

    it('adds a candidates panel in the given order', () => {
      const clip = t.addClip();
      const [m1, m2, m3] = t.addMoments(clip.id, [{}, {}, {}]);
      const p = t.svc.addPanel(sceneA, { intent: 'x', candidates: [m3, m1, m2] });
      expect(p.state).toBe('candidates');
      const tree = t.svc.getCut(cutId)!;
      expect(tree.scenes[0].panels[0].candidates.map((m) => m.id)).toEqual([m3, m1, m2]);
    });

    it('adds a filled panel that points at a moment (AI source leaves the moment proposed, range stays on the moment)', () => {
      const clip = t.addClip({ fps: 120 });
      const [m] = t.addMoments(clip.id, [{ start_sec: 2, end_sec: 8, suggested_speed: 0.5 }]);
      const p = t.svc.addPanel(sceneA, { intent: 'x', momentId: m });
      expect(p).toMatchObject({ state: 'filled', clip_id: clip.id, moment_id: m, source: 'ai' });
      expect(p).not.toHaveProperty('start_sec');
      expect(t.db.prepare('SELECT start_sec, end_sec, speed FROM highlights WHERE id = ?').get(m)).toEqual({ start_sec: 2, end_sec: 8, speed: 0.5 });
      expect(t.db.prepare('SELECT status FROM highlights WHERE id = ?').get(m)).toEqual({ status: 'proposed' });
    });

    it('adds panels at a position and keeps positions dense', () => {
      t.svc.addPanel(sceneA, { intent: 'a' });
      t.svc.addPanel(sceneA, { intent: 'b' });
      t.svc.addPanel(sceneA, { intent: 'first' }, 0);
      expect(t.svc.getCut(cutId)!.scenes[0].panels.map((p) => p.intent)).toEqual(['first', 'a', 'b']);
      expect(positions(sceneA)).toEqual([0, 1, 2]);
    });

    it('deletes a panel and closes the gap', () => {
      const a = t.svc.addPanel(sceneA, { intent: 'a' });
      t.svc.addPanel(sceneA, { intent: 'b' });
      t.svc.deletePanel(a.id);
      expect(t.svc.getCut(cutId)!.scenes[0].panels.map((p) => p.intent)).toEqual(['b']);
      expect(positions(sceneA)).toEqual([0]);
    });

    it('moves a panel within a scene', () => {
      t.svc.addPanel(sceneA, { intent: 'a' });
      t.svc.addPanel(sceneA, { intent: 'b' });
      const c = t.svc.addPanel(sceneA, { intent: 'c' });
      t.svc.movePanel(c.id, sceneA, 0);
      expect(t.svc.getCut(cutId)!.scenes[0].panels.map((p) => p.intent)).toEqual(['c', 'a', 'b']);
      expect(positions(sceneA)).toEqual([0, 1, 2]);
    });

    it('moves a panel across scenes; both scenes stay dense', () => {
      const a = t.svc.addPanel(sceneA, { intent: 'a' });
      t.svc.addPanel(sceneA, { intent: 'b' });
      t.svc.addPanel(sceneB, { intent: 'x' });
      t.svc.movePanel(a.id, sceneB, 0);
      const tree = t.svc.getCut(cutId)!;
      expect(tree.scenes[0].panels.map((p) => p.intent)).toEqual(['b']);
      expect(tree.scenes[1].panels.map((p) => p.intent)).toEqual(['a', 'x']);
      expect(positions(sceneA)).toEqual([0]);
      expect(positions(sceneB)).toEqual([0, 1]);
      expect(tree.scenes[1].panels[0].scene_id).toBe(sceneB);
    });

    it('refuses to move a panel into a scene of another cut', () => {
      const other = t.svc.createCut(t.projectId, 'Other');
      const foreign = t.svc.addScene(other.id, 'F').id;
      const p = t.svc.addPanel(sceneA, { intent: 'a' });
      expect(() => t.svc.movePanel(p.id, foreign, 0)).toThrow(/another cut/);
    });

    it('sets intent', () => {
      const p = t.svc.addPanel(sceneA, { intent: 'a' });
      t.svc.setIntent(p.id, 'new');
      expect(t.svc.getCut(cutId)!.scenes[0].panels[0].intent).toBe('new');
    });

    it('deleting a scene removes its panels', () => {
      t.svc.addPanel(sceneA, { intent: 'a' });
      t.svc.deleteScene(sceneA);
      expect(t.db.prepare('SELECT COUNT(*) AS n FROM story_segments').get()).toEqual({ n: 0 });
    });
  });

  describe('trim and speed (on the moment)', () => {
    let momentId: number;
    let sceneId: number;
    const mk = (fps: number, extra: Record<string, number | string> = {}) => {
      const clip = t.addClip({ fps, duration: 20 });
      [momentId] = t.addMoments(clip.id, [{ start_sec: 2, end_sec: 8, ...extra }]);
    };
    beforeEach(() => { sceneId = t.svc.addScene(cutId, 'S').id; });
    const row = () => t.db.prepare('SELECT status, start_sec, end_sec, speed FROM highlights WHERE id = ?').get(momentId) as any;
    const userTier = () => t.db.prepare('SELECT user_tier FROM highlights WHERE id = ?').get(momentId);

    it('trims within the clip', () => {
      mk(25);
      t.svc.trimMoment(momentId, 3, 6);
      expect(row()).toMatchObject({ start_sec: 3, end_sec: 6 });
    });

    it('clamps to the clip duration and to zero', () => {
      mk(25);
      t.svc.trimMoment(momentId, -4, 99);
      expect(row()).toMatchObject({ start_sec: 0, end_sec: 20 });
    });

    it('rejects a trim shorter than 0.5 s and leaves the moment alone', () => {
      mk(25);
      expect(() => t.svc.trimMoment(momentId, 5, 5.2)).toThrow(/0\.5/);
      expect(row()).toMatchObject({ start_sec: 2, end_sec: 8, status: 'proposed' });
    });

    it('speed 1 is always allowed; 0.5 needs fps >= 48; 0.25 needs fps >= 90', () => {
      mk(25);
      expect(() => t.svc.setMomentSpeed(momentId, 0.5)).toThrow(/fps/);
      t.svc.setMomentSpeed(momentId, 1);

      mk(50);
      t.svc.setMomentSpeed(momentId, 0.5);
      expect(row().speed).toBe(0.5);
      expect(() => t.svc.setMomentSpeed(momentId, 0.25)).toThrow(/fps/);

      mk(120);
      t.svc.setMomentSpeed(momentId, 0.25);
      expect(row().speed).toBe(0.25);
    });

    it('rejects speeds outside 1 | 0.5 | 0.25', () => {
      mk(120);
      expect(() => t.svc.setMomentSpeed(momentId, 2)).toThrow(/speed/i);
    });

    it('trim and speed touch the moment: confirmed, and every panel using it becomes user-owned (intent does not)', () => {
      mk(120);
      const clipId = (t.db.prepare('SELECT clip_id FROM highlights WHERE id = ?').get(momentId) as any).clip_id;
      const [m2] = t.addMoments(clipId, [{ start_sec: 10, end_sec: 14 }]);
      const a = t.svc.addPanel(sceneId, { momentId, source: 'ai' });
      const a2 = t.svc.addPanel(sceneId, { momentId, source: 'ai' });
      const b = t.svc.addPanel(sceneId, { momentId: m2, source: 'ai' });
      const src = (id: number) => (t.db.prepare('SELECT source FROM story_segments WHERE id = ?').get(id) as any).source;
      t.svc.setIntent(a.id, 'new intent');
      expect([src(a.id), row().status]).toEqual(['ai', 'proposed']);
      t.svc.trimMoment(momentId, 3, 6);
      expect([src(a.id), src(a2.id), src(b.id), row().status]).toEqual(['user', 'user', 'ai', 'confirmed']);
      t.svc.setMomentSpeed(m2, 0.5);
      expect(src(b.id)).toBe('user');
      expect((t.db.prepare('SELECT status FROM highlights WHERE id = ?').get(m2) as any).status).toBe('confirmed');
    });

    it('the tree, totals and a shared moment read range and speed from the moment', () => {
      mk(120);
      const a = t.svc.addPanel(sceneId, { momentId });
      const b = t.svc.addPanel(sceneId, { momentId });
      t.svc.trimMoment(momentId, 3, 7);
      t.svc.setMomentSpeed(momentId, 0.5);
      const tree = t.svc.getCut(cutId)!;
      expect(tree.scenes[0].panels.map((p) => [p.id, p.start_sec, p.end_sec, p.speed])).toEqual([[a.id, 3, 7, 0.5], [b.id, 3, 7, 0.5]]);
      expect(tree.totals.duration_sec).toBe(16);
    });

    it('a rejected moment keeps its status when edited', () => {
      mk(25);
      t.svc.rejectMoment(momentId, 'shaky');
      t.svc.trimMoment(momentId, 3, 6);
      expect(row()).toMatchObject({ status: 'rejected', start_sec: 3, end_sec: 6 });
    });

    it('setMomentTier sets and clears the user tier without touching the moment', () => {
      mk(25);
      t.svc.setMomentTier(momentId, 'hero');
      expect(t.db.prepare('SELECT user_tier, status FROM highlights WHERE id = ?').get(momentId)).toEqual({ user_tier: 'hero', status: 'proposed' });
      t.svc.setMomentTier(momentId, null);
      expect(userTier()).toEqual({ user_tier: null });
      expect(() => t.svc.setMomentTier(momentId, 'best' as never)).toThrow(/tier/i);
    });

    it('starMoment stars; unstar goes back to the AI tier, or demotes an AI hero to solid', () => {
      mk(25, { tier: 'solid' });
      t.svc.starMoment(momentId, true);
      expect(userTier()).toEqual({ user_tier: 'hero' });
      t.svc.starMoment(momentId, false);
      expect(userTier()).toEqual({ user_tier: null });
      t.db.prepare("UPDATE highlights SET tier = 'hero' WHERE id = ?").run(momentId);
      t.svc.starMoment(momentId, false);
      expect(userTier()).toEqual({ user_tier: 'solid' });
    });

    it('resetMoment goes back to the ai range and the default speed, leaves status and tier', () => {
      mk(50, { suggested_speed: 0.5 });
      t.svc.trimMoment(momentId, 4, 5);
      t.svc.setMomentSpeed(momentId, 1);
      t.svc.setMomentTier(momentId, 'hero');
      t.svc.resetMoment(momentId);
      expect(row()).toEqual({ status: 'confirmed', start_sec: 2, end_sec: 8, speed: 0.5 });
      expect(userTier()).toEqual({ user_tier: 'hero' });
    });
  });

  describe('place, pick, reject, hide', () => {
    let scene: number;
    let clip: { id: number };
    let m: number[];
    beforeEach(() => {
      scene = t.svc.addScene(cutId, 'S').id;
      clip = t.addClip({ fps: 120 });
      m = t.addMoments(clip.id, [
        { start_sec: 1, end_sec: 4, suggested_speed: 0.5 },
        { start_sec: 6, end_sec: 9 },
        { start_sec: 11, end_sec: 15 },
      ]);
    });
    const status = (id: number) => (t.db.prepare('SELECT status, reject_reason FROM highlights WHERE id = ?').get(id) as any);
    const panel = (i = 0) => t.svc.getCut(cutId)!.scenes[0].panels[i];

    it('place fills a gap panel from the moment, marks it confirmed and source user', () => {
      const p = t.svc.addPanel(scene, { intent: 'x' });
      t.svc.placeMoment(p.id, m[0]);
      expect(panel()).toMatchObject({ state: 'filled', clip_id: clip.id, moment_id: m[0], start_sec: 1, end_sec: 4, speed: 0.5, source: 'user' });
      expect(status(m[0]).status).toBe('confirmed');
    });

    it('place clears candidates', () => {
      const p = t.svc.addPanel(scene, { intent: 'x', candidates: [m[0], m[1]] });
      t.svc.placeMoment(p.id, m[0]);
      expect(panel().candidates).toEqual([]);
      expect(t.db.prepare('SELECT COUNT(*) AS n FROM panel_candidates').get()).toEqual({ n: 0 });
    });

    it('pick candidate places it; non-candidates are refused', () => {
      const p = t.svc.addPanel(scene, { intent: 'x', candidates: [m[0], m[1]] });
      expect(() => t.svc.pickCandidate(p.id, m[2])).toThrow(/candidate/);
      t.svc.pickCandidate(p.id, m[1]);
      expect(panel()).toMatchObject({ state: 'filled', moment_id: m[1], source: 'user' });
      expect(status(m[1]).status).toBe('confirmed');
    });

    it('placing a rejected moment or a hidden clip is refused', () => {
      const p = t.svc.addPanel(scene, { intent: 'x' });
      t.svc.rejectMoment(m[0]);
      expect(() => t.svc.placeMoment(p.id, m[0])).toThrow(/rejected/);
      t.svc.hideClip(clip.id);
      expect(() => t.svc.placeMoment(p.id, m[1])).toThrow(/hidden/);
    });

    it('reject sets status and reason, removes the moment from candidate lists', () => {
      t.svc.addPanel(scene, { intent: 'x', candidates: [m[0], m[1], m[2]] });
      t.svc.rejectMoment(m[1], 'shaky');
      expect(status(m[1])).toEqual({ status: 'rejected', reject_reason: 'shaky' });
      expect(panel().candidates.map((c) => c.id)).toEqual([m[0], m[2]]);
      expect(t.db.prepare('SELECT position FROM panel_candidates ORDER BY position').all()).toEqual([{ position: 0 }, { position: 1 }]);
    });

    it('rejecting the last candidate turns the panel into a gap', () => {
      t.svc.addPanel(scene, { intent: 'x', candidates: [m[0]] });
      t.svc.rejectMoment(m[0]);
      expect(panel().state).toBe('gap');
    });

    it('rejecting the moment of a filled panel makes it a gap (source stays)', () => {
      const p = t.svc.addPanel(scene, { intent: 'x' });
      t.svc.placeMoment(p.id, m[0]);
      t.svc.rejectMoment(m[0], 'blurry');
      expect(panel()).toMatchObject({ state: 'gap', clip_id: null, moment_id: null, start_sec: null, end_sec: null, speed: 1, source: 'user' });
      expect(panel().intent).toBe('x');
    });

    it('rejecting a moment leaves unrelated panels alone', () => {
      const p1 = t.svc.addPanel(scene, { intent: 'a' });
      const p2 = t.svc.addPanel(scene, { intent: 'b' });
      t.svc.placeMoment(p1.id, m[0]);
      t.svc.placeMoment(p2.id, m[1]);
      t.svc.rejectMoment(m[0]);
      expect(panel(0).state).toBe('gap');
      expect(panel(1).state).toBe('filled');
    });

    it('hide clip cascades to panels and candidates of its moments; unhide only clears the flag', () => {
      const other = t.addClip();
      const [o] = t.addMoments(other.id, [{}]);
      const p1 = t.svc.addPanel(scene, { intent: 'a' });
      t.svc.placeMoment(p1.id, m[0]);
      t.svc.addPanel(scene, { intent: 'b', candidates: [m[1], o] });
      t.svc.hideClip(clip.id);
      expect(t.db.prepare('SELECT hidden FROM clips WHERE id = ?').get(clip.id)).toEqual({ hidden: 1 });
      expect(panel(0).state).toBe('gap');
      expect(panel(1).candidates.map((c) => c.id)).toEqual([o]);

      t.svc.unhideClip(clip.id);
      expect(t.db.prepare('SELECT hidden FROM clips WHERE id = ?').get(clip.id)).toEqual({ hidden: 0 });
      expect(panel(0).state).toBe('gap');
      expect(panel(1).candidates.map((c) => c.id)).toEqual([o]);
    });
  });

  describe('getCut', () => {
    it('returns null for an unknown cut', () => {
      expect(t.svc.getCut(999)).toBeNull();
    });

    it('returns the tree with parsed brief, clip, moment and totals', () => {
      const clip = t.addClip({ fps: 120, duration: 30 });
      const [m1, m2, m3] = t.addMoments(clip.id, [
        { start_sec: 0, end_sec: 10, suggested_speed: 0.5 },
        { start_sec: 12, end_sec: 16 },
        { start_sec: 20, end_sec: 24 },
      ]);
      const s1 = t.svc.addScene(cutId, 'One').id;
      const s2 = t.svc.addScene(cutId, 'Two').id;
      t.svc.addPanel(s1, { intent: 'filled slow', momentId: m1 });
      t.svc.addPanel(s1, { intent: 'filled', momentId: m2 });
      t.svc.addPanel(s2, { intent: 'cands', candidates: [m3, m2] });
      t.svc.addPanel(s2, { intent: 'gap' });
      t.db.prepare("UPDATE stories SET brief = ?, brief_state = 'proposed' WHERE id = ?").run('{"target_sec":60}', cutId);

      const tree = t.svc.getCut(cutId)!;
      expect(tree.cut.id).toBe(cutId);
      expect(tree.brief).toEqual({ target_sec: 60 });
      expect(tree.brief_state).toBe('proposed');
      const first = tree.scenes[0].panels[0];
      expect(first.clip).toMatchObject({ id: clip.id, fps: 120, duration_sec: 30 });
      expect(first.moment).toMatchObject({ id: m1 });
      expect(tree.scenes[1].panels[0].candidates.map((c) => c.id)).toEqual([m3, m2]);
      // m1: 10 s of source at 0.5x = 20 s, m2: 4 s
      expect(tree.totals).toEqual({ panels: 4, filled: 2, candidates: 1, gaps: 1, duration_sec: 24 });
    });

    it('has a null brief and no scenes for a fresh cut', () => {
      const tree = t.svc.getCut(cutId)!;
      expect(tree.brief).toBeNull();
      expect(tree.scenes).toEqual([]);
      expect(tree.totals).toEqual({ panels: 0, filled: 0, candidates: 0, gaps: 0, duration_sec: 0 });
    });
  });
  describe('the moment is the edit: place, add and confirm', () => {
    let scene: number;
    const status = (id: number) => (t.db.prepare('SELECT status, reject_reason FROM highlights WHERE id = ?').get(id) as any);
    const panel = (i = 0) => t.svc.getCut(cutId)!.scenes[0].panels[i];
    beforeEach(() => { scene = t.svc.addScene(cutId, 'S').id; });

    it('place plays the whole moment (no 4 s window) and does not change its range', () => {
      const clip = t.addClip({ fps: 25 });
      const [m] = t.addMoments(clip.id, [{ start_sec: 10, end_sec: 31 }]);
      const p = t.svc.addPanel(scene, { intent: 'x' });
      t.svc.placeMoment(p.id, m);
      expect(panel()).toMatchObject({ start_sec: 10, end_sec: 31, speed: 1, source: 'user' });
    });

    it('a suggested 0.5 on a 25 fps clip never becomes the moment speed', () => {
      const clip = t.addClip({ fps: 25 });
      const [m] = t.addMoments(clip.id, [{ start_sec: 0, end_sec: 10, suggested_speed: 0.5 }]);
      const p = t.svc.addPanel(scene, { intent: 'x' });
      t.svc.placeMoment(p.id, m);
      expect(panel()).toMatchObject({ start_sec: 0, end_sec: 10, speed: 1 });
    });

    it('addPanel with a moment (user source) confirms the moment; AI source does not', () => {
      const clip = t.addClip({ fps: 50 });
      const [m] = t.addMoments(clip.id, [{ start_sec: 0, end_sec: 10, suggested_speed: 0.5 }]);
      t.svc.addPanel(scene, { intent: 'x', momentId: m, source: 'user' });
      expect(panel()).toMatchObject({ state: 'filled', start_sec: 0, end_sec: 10, speed: 0.5 });
      expect(status(m).status).toBe('confirmed');
      const [m2] = t.addMoments(clip.id, [{}]);
      t.svc.addPanel(scene, { momentId: m2 });
      expect(status(m2).status).toBe('proposed');
    });

    it('addPanel with explicit in/out/speed writes them to the moment without confirming it', () => {
      const clip = t.addClip({ fps: 120 });
      const [m] = t.addMoments(clip.id, [{ start_sec: 0, end_sec: 10, suggested_speed: 0.5 }]);
      t.svc.addPanel(scene, { momentId: m, startSec: 1, endSec: 9, speed: 1 });
      expect(panel()).toMatchObject({ start_sec: 1, end_sec: 9, speed: 1 });
      expect(t.db.prepare('SELECT start_sec, end_sec, speed, status FROM highlights WHERE id = ?').get(m))
        .toEqual({ start_sec: 1, end_sec: 9, speed: 1, status: 'proposed' });
    });

    it('a draft never overwrites the in/out/speed of a moment the user has confirmed', () => {
      const clip = t.addClip({ fps: 50 });
      const [m] = t.addMoments(clip.id, [{ start_sec: 0, end_sec: 10 }]);
      t.svc.trimMoment(m, 2, 6);
      t.svc.setMomentSpeed(m, 0.5);
      t.svc.addPanel(scene, { momentId: m, startSec: 1, endSec: 9, speed: 1 });
      expect(t.db.prepare('SELECT start_sec, end_sec, speed, status FROM highlights WHERE id = ?').get(m))
        .toEqual({ start_sec: 2, end_sec: 6, speed: 0.5, status: 'confirmed' });
    });

    it('trimPanel and setSpeed are gone', () => {
      const svc = t.svc as unknown as Record<string, unknown>;
      expect([svc.trimPanel, svc.setSpeed]).toEqual([undefined, undefined]);
    });

    it('unrejectMoment restores proposed and clears the reason', () => {
      const clip = t.addClip();
      const [m] = t.addMoments(clip.id, [{}]);
      t.svc.rejectMoment(m, 'shaky');
      t.svc.unrejectMoment(m);
      expect(status(m)).toEqual({ status: 'proposed', reject_reason: null });
    });

    it('addScene accepts an event_id', () => {
      const ev = Number(t.db.prepare("INSERT INTO events (project_id, name, source) VALUES (?, 'E', 'folder')").run(t.projectId).lastInsertRowid);
      const s = t.svc.addScene(cutId, 'With event', { eventId: ev });
      expect(s.event_id).toBe(ev);
    });
  });
});
