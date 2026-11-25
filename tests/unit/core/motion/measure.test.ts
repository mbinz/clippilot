import { describe, it, expect, beforeEach } from 'vitest';
import { ClipRepository } from '../../../../src/db/repositories/clip.repository.js';
import { HighlightRepository } from '../../../../src/db/repositories/highlight.repository.js';
import { MotionRepository } from '../../../../src/db/repositories/motion.repository.js';
import { measureClips, isMeasured, type ClipFrameSource, type CurveMeasurer } from '../../../../src/core/motion/index.js';
import { PATCH_COUNT, momentMotion, type RawCurve } from '../../../../src/core/motion/curve.js';
import type { Shift } from '../../../../src/core/motion/motion.js';
import { DEFAULT_CONFIG } from '../../../../src/core/config/defaults.js';
import { setup } from '../storyboard/_helpers.js';

const FPS = 25;
const zeros = (n: number): Shift[] => Array.from({ length: n }, () => ({ dx: 0, dy: 0 }));
function raw(shifts: Shift[], fps = FPS): RawCurve {
  const n = shifts.length;
  const pdx = new Int8Array(n * PATCH_COUNT), pdy = new Int8Array(n * PATCH_COUNT);
  shifts.forEach((s, i) => { for (let j = 0; j < PATCH_COUNT; j++) { pdx[i * PATCH_COUNT + j] = s.dx; pdy[i * PATCH_COUNT + j] = s.dy; } });
  return {
    fps, width: 320, srcWidth: 1920, dx: Int8Array.from(shifts.map((s) => s.dx)), dy: Int8Array.from(shifts.map((s) => s.dy)),
    change: new Float32Array(n).fill(0.02), patchDx: pdx, patchDy: pdy, texture: new Float32Array(n * PATCH_COUNT).fill(20),
  };
}
/** 16 s clip with one clear jolt around 4.0 - 4.7 s and some mild handheld wobble. */
function joltShifts(): Shift[] {
  const s = zeros(400);
  for (let k = 0; k < 3; k++) { s[100 + k] = { dx: 6, dy: 0 }; s[103 + k] = { dx: -6, dy: 0 }; }
  return s;
}

describe('measureClips (per whole clip)', () => {
  let t: ReturnType<typeof setup>;
  let clips: ClipRepository;
  let highlights: HighlightRepository;
  let motion: MotionRepository;
  let decodes: { file: string; fps: number }[];
  let shifts: Shift[];
  const cfg = DEFAULT_CONFIG;

  const source: ClipFrameSource = async (req) => {
    decodes.push(req);
    return { w: 320, h: 180, srcWidth: 1920, frames: (async function* () { /* the injected measurer ignores the frames */ })() };
  };
  const measurer: CurveMeasurer = async (_frames, dims) => raw(shifts, dims.fps);

  beforeEach(() => {
    t = setup();
    clips = new ClipRepository(t.db);
    highlights = new HighlightRepository(t.db);
    motion = new MotionRepository(t.db);
    decodes = [];
    shifts = joltShifts();
  });
  const run = (over: { force?: boolean; source?: ClipFrameSource; exists?: (p: string) => boolean } = {}) =>
    measureClips(clips.listByProject(t.projectId), { highlights, motion }, {
      cfg, source: over.source ?? source, measurer, force: over.force, exists: over.exists ?? (() => true),
    });

  it('decodes each clip once (not per moment), stores curve + shakes, writes the moment columns from the curve', async () => {
    const c = t.addClip({ fps: 25 });
    const [a, b] = t.addMoments(c.id, [{ start_sec: 1, end_sec: 3.5 }, { start_sec: 8, end_sec: 12 }]);
    const r = await run();
    expect(decodes).toEqual([{ file: '/v/c1.mp4', fps: 25 }]);
    expect(r).toMatchObject({ measured: 1, skipped: 0, failed: 0, errors: [] });
    expect(r.shakes.high).toBe(1);
    const curve = motion.getCurve(c.id)!;
    expect(curve.dx.length).toBe(400);
    expect(motion.getShakes(c.id)).toHaveLength(1);
    const m = highlights.findByClip(c.id).find((h) => h.id === a)!;
    const want = momentMotion(curve, 1, 3.5);
    expect(m).toMatchObject({ jitter_score: want.jitter.score, jitter_max_px: want.jitter.maxPx, camera_motion: want.camera, motion_start_sec: 1, motion_end_sec: 3.5 });
    expect(isMeasured(m)).toBe(true);
    expect(isMeasured(highlights.findByClip(c.id).find((h) => h.id === b)!)).toBe(true);
    expect(r.bands.locked + r.bands.stabilize + r.bands.shaky).toBe(2);
  });

  it('is resumable: clips with a curve are not decoded again, --force redoes them; columns are refreshed either way', async () => {
    const c = t.addClip();
    const [a] = t.addMoments(c.id, [{ start_sec: 8, end_sec: 12 }]);
    await run();
    decodes.length = 0;
    expect(await run()).toMatchObject({ measured: 0, skipped: 1 });
    expect(decodes).toHaveLength(0);
    // trim: no decode, the columns follow the new range
    t.db.prepare('UPDATE highlights SET start_sec = 9 WHERE id = ?').run(a);
    expect(isMeasured(highlights.findByClip(c.id)[0])).toBe(false);
    await run();
    expect(decodes).toHaveLength(0);
    expect(highlights.findByClip(c.id)[0]).toMatchObject({ motion_start_sec: 9, motion_end_sec: 12 });
    expect(await run({ force: true })).toMatchObject({ measured: 1, skipped: 0 });
    expect(decodes).toHaveLength(1);
  });

  it('skips hidden clips, clips without video and clips whose moments are all rejected', async () => {
    const hidden = t.addClip(); const rej = t.addClip(); const none = t.addClip();
    t.addMoments(hidden.id, [{}]); t.addMoments(rej.id, [{}]);
    t.db.prepare('UPDATE clips SET hidden = 1 WHERE id = ?').run(hidden.id);
    t.db.prepare("UPDATE highlights SET status = 'rejected' WHERE clip_id = ?").run(rej.id);
    void none;
    expect(await run()).toMatchObject({ measured: 0, skipped: 0, failed: 0 });
    expect(decodes).toHaveLength(0);
  });

  it('never changes ranges, status, tier or speed of confirmed / edited moments', async () => {
    const c = t.addClip();
    const [a] = t.addMoments(c.id, [{ start_sec: 4.1, end_sec: 9 }]);
    t.db.prepare("UPDATE highlights SET status = 'confirmed', user_tier = 'hero', speed = 0.5 WHERE id = ?").run(a);
    const cols = 'id, clip_id, start_sec, end_sec, status, tier, user_tier, speed, ai_start_sec, ai_end_sec';
    const before = t.db.prepare(`SELECT ${cols} FROM highlights`).all();
    await run();
    expect(t.db.prepare(`SELECT ${cols} FROM highlights`).all()).toEqual(before);
    expect(highlights.findByClip(c.id)[0].jitter_score).not.toBeNull();
  });

  it('falls back to the proxy; fails the clip when neither exists; a failing decode does not stop the run', async () => {
    const c = t.addClip(); const d = t.addClip();
    t.addMoments(c.id, [{}]); t.addMoments(d.id, [{}]);
    t.db.prepare("UPDATE clips SET proxy_path = '/p/c1.mp4' WHERE id = ?").run(c.id);
    const r = await run({ exists: (p) => p === '/p/c1.mp4' });
    expect(decodes[0].file).toMatch(/p\/c1\.mp4$/);
    expect(r).toMatchObject({ measured: 1, failed: 1 });
    expect(r.errors[0]).toMatchObject({ clip_id: d.id });
    expect(r.errors[0].message).toMatch(/Neither the original nor the proxy/);
    let n = 0;
    const flaky: ClipFrameSource = async (req) => { if (n++ === 0) throw new Error('frame count mismatch: decoded 10, file has 50'); return source(req); };
    t.db.prepare('DELETE FROM motion_curves').run();
    const r2 = await run({ source: flaky });
    expect(r2.failed).toBe(1);
    expect(r2.errors[0].message).toMatch(/frame count mismatch/);
  });

  it('a fresh measurement (--force) forgets the shake fit results of the clip', async () => {
    const c = t.addClip();
    const [a] = t.addMoments(c.id, [{ start_sec: 1, end_sec: 3 }]);
    await run();
    highlights.setShakeStatus(a, 'kept', 'because', 1, 3);
    await run();
    expect(highlights.findById(a)!.shake_status).toBe('kept');
    await run({ force: true });
    expect(highlights.findById(a)).toMatchObject({ shake_status: null, shake_note: null, shake_checked_start: null });
  });
});
