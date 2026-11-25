import { describe, it, expect, beforeEach } from 'vitest';
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
