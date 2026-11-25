import { describe, it, expect, beforeEach } from 'vitest';
import { MotionRepository } from '../../../../src/db/repositories/motion.repository.js';
import { momentMotion } from '../../../../src/core/motion/curve.js';
import { setup } from './_helpers.js';

describe('moments carry jitter and motion', () => {
  let t: ReturnType<typeof setup>;
  let measured: number;
  let unmeasured: number;
  let stale: number;

  beforeEach(() => {
    t = setup();
    const c = t.addClip().id;
    [measured, unmeasured, stale] = t.addMoments(c, [{ start_sec: 2, end_sec: 6 }, { start_sec: 10, end_sec: 14 }, { start_sec: 20, end_sec: 24 }]);
    const set = t.db.prepare('UPDATE highlights SET jitter_score = ?, jitter_max_px = 1, camera_motion = ?, frame_change = ?, motion_start_sec = ?, motion_end_sec = ? WHERE id = ?');
    set.run(0.1, 3.5, 0.05, 2, 6, measured);
    set.run(0.5, 0, 0.2, 20, 23, stale); // trimmed after measuring: end 24 vs measured 23
  });

  it('moments list rows have jitter {score, band} and motion {camera, change}; null when unmeasured or stale', () => {
    const rows = t.svc.listMoments(t.projectId);
    expect(rows.find((r) => r.id === measured)).toMatchObject({ jitter: { score: 0.1, band: 'stabilize' }, motion: { camera: 3.5, change: 0.05 } });
    expect(rows.find((r) => r.id === unmeasured)).toMatchObject({ jitter: null, motion: null });
    expect(rows.find((r) => r.id === stale)).toMatchObject({ jitter: null, motion: null });
  });

  it('bands follow the thresholds', () => {
    t.db.prepare('UPDATE highlights SET jitter_score = 0.5, motion_start_sec = 2, motion_end_sec = 6 WHERE id = ?').run(measured);
    expect(t.svc.listMoments(t.projectId).find((r) => r.id === measured)!.jitter!.band).toBe('shaky');
    t.db.prepare('UPDATE highlights SET jitter_score = 0 WHERE id = ?').run(measured);
    expect(t.svc.listMoments(t.projectId).find((r) => r.id === measured)!.jitter!.band).toBe('locked');
  });

  it('cut show: the panel moment and its candidates carry jitter and motion', () => {
    const cut = t.svc.createCut(t.projectId, 'C').id;
    const scene = t.svc.addScene(cut, 'S').id;
    t.svc.addPanel(scene, { intent: 'a', momentId: measured });
    t.svc.addPanel(scene, { intent: 'b', candidates: [measured, unmeasured] });
    const panels = t.svc.getCut(cut)!.scenes[0].panels;
    expect(panels[0].moment).toMatchObject({ jitter: { score: 0.1, band: 'stabilize' }, motion: { camera: 3.5, change: 0.05 } });
    expect(panels[1].candidates.map((c) => c.jitter?.band ?? null)).toEqual(['stabilize', null]);
  });
});

describe('moments carry shakes and curve-derived jitter (W1)', () => {
  let t: ReturnType<typeof setup>;
  let clip: number;
  let other: number;
  let a: number; let b: number; let far: number; let noCurve: number;

  beforeEach(() => {
    t = setup();
    clip = t.addClip().id;
    other = t.addClip().id;
    [a, b, far] = t.addMoments(clip, [{ start_sec: 2, end_sec: 6 }, { start_sec: 4.1, end_sec: 9 }, { start_sec: 20, end_sec: 24 }]);
    [noCurve] = t.addMoments(other, [{ start_sec: 2, end_sec: 6 }]);
    const n = 750;
    const dx = new Int8Array(n);
    for (let i = 100; i < 103; i++) { dx[i] = 6; dx[i + 3] = -6; }
    new MotionRepository(t.db).save(clip, {
      curve: { fps: 25, width: 320, srcWidth: 1920, dx, dy: new Int8Array(n), change: new Float32Array(n).fill(0.03) },
      medianResidual: 0, continuous: false,
      shakes: [{ start_sec: 3.98, end_sec: 4.3, peak_sec: 4.08, peak: 46.9, jump_pct: 4.3, jump_px: 83, disagreement: 0, moving_scene: false, confidence: 'high' }],
    });
  });

  it('jitter comes from the curve for the current range, also when the stored columns are stale or missing', () => {
    t.db.prepare('UPDATE highlights SET jitter_score = 9, motion_start_sec = 0, motion_end_sec = 1 WHERE id = ?').run(a); // stale
    const rows = t.svc.listMoments(t.projectId);
    const ra = rows.find((r) => r.id === a)!;
    const want = momentMotion(new MotionRepository(t.db).getCurve(clip)!, 2, 6);
    expect(ra.jitter!.score).toBeCloseTo(want.jitter.score, 9);
    expect(ra.motion).toEqual({ camera: want.camera, change: expect.closeTo(0.03, 5) });
    expect(rows.find((r) => r.id === far)!.jitter).not.toBeNull();
  });

  it('shakes: those overlapping the moment (clip time); [] when none; null when the clip has no curve', () => {
    const rows = t.svc.listMoments(t.projectId);
    expect(rows.find((r) => r.id === a)!.shakes).toEqual([
      { start: 3.98, end: 4.3, peak_at: 4.08, strength: 46.9, jump_pct: 4.3, jump_px: 83, confidence: 'high', moving_scene: false },
    ]);
    expect(rows.find((r) => r.id === b)!.shakes).toHaveLength(1); // 4.1 .. 9 overlaps 3.98 .. 4.3
    expect(rows.find((r) => r.id === far)!.shakes).toEqual([]);
    expect(rows.find((r) => r.id === noCurve)!.shakes).toBeNull();
    expect(rows.find((r) => r.id === noCurve)!.jitter).toBeNull();
  });

  it("a border-case shake in a slowed-down moment reads as low confidence (speed of the moment)", () => {
    t.db.prepare('UPDATE shakes SET peak = 15 WHERE clip_id = ?').run(clip);
    expect(t.svc.listMoments(t.projectId).find((r) => r.id === a)!.shakes![0].confidence).toBe('high');
    t.db.prepare('UPDATE highlights SET speed = 0.5 WHERE id = ?').run(a);
    expect(t.svc.listMoments(t.projectId).find((r) => r.id === a)!.shakes![0].confidence).toBe('low');
  });

  it('cut show: the panel moment and its candidates carry jitter and shakes', () => {
    const cut = t.svc.createCut(t.projectId, 'C').id;
    const scene = t.svc.addScene(cut, 'S').id;
    t.svc.addPanel(scene, { intent: 'a', momentId: a });
    t.svc.addPanel(scene, { intent: 'b', candidates: [b, noCurve] });
    const panels = t.svc.getCut(cut)!.scenes[0].panels;
    expect(panels[0].moment!.shakes).toHaveLength(1);
    expect(panels[0].moment!.jitter).not.toBeNull();
    expect(panels[1].candidates.map((c) => c.shakes?.length ?? null)).toEqual([1, null]);
  });
});
