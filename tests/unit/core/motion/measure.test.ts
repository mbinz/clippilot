import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../../src/db/migrations/runner.js';
import { ClipRepository } from '../../../../src/db/repositories/clip.repository.js';
import { HighlightRepository } from '../../../../src/db/repositories/highlight.repository.js';
import { measureClips, isMeasured, type FrameSource } from '../../../../src/core/motion/index.js';
import { DEFAULT_CONFIG } from '../../../../src/core/config/defaults.js';
import { setup } from '../storyboard/_helpers.js';

const W = 64, H = 36;
function noise(seed: number): Uint8Array {
  let s = seed;
  const a = new Uint8Array(W * H);
  for (let i = 0; i < a.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; a[i] = (s >> 16) & 255; }
  return a;
}
/** Static scene: every frame identical, so shake 0 and band locked. */
const staticSource = (calls: { file: string; startSec: number; durationSec: number; fps: number }[]): FrameSource => async (req) => {
  calls.push(req);
  const f = noise(1);
  return { w: W, h: H, frames: Array.from({ length: 12 }, () => f) };
};

describe('migration 021', () => {
  it('adds the motion columns to highlights, null by default', () => {
    const t = setup();
    const c = t.addClip();
    const [m] = t.addMoments(c.id, [{}]);
    const row = t.db.prepare('SELECT * FROM highlights WHERE id = ?').get(m) as Record<string, unknown>;
    for (const k of ['shake_score', 'shake_max_px', 'camera_motion', 'frame_change', 'motion_start_sec', 'motion_end_sec']) {
      expect(row).toHaveProperty(k, null);
    }
  });
});

describe('measureClips', () => {
  let db: Database.Database;
  let clips: ClipRepository;
  let highlights: HighlightRepository;
  let t: ReturnType<typeof setup>;
  let calls: { file: string; startSec: number; durationSec: number; fps: number }[];
  const cfg = DEFAULT_CONFIG;

  beforeEach(() => {
    t = setup();
    db = t.db;
    clips = new ClipRepository(db);
    highlights = new HighlightRepository(db);
    calls = [];
  });
  const run = (over: { force?: boolean; source?: FrameSource } = {}) =>
    measureClips(clips.listByProject(t.projectId), { highlights }, {
      cfg, source: over.source ?? staticSource(calls), force: over.force, exists: () => true,
    });

  it('measures every moment, stores the range, and counts the bands', async () => {
    const c = t.addClip({ fps: 30 });
    const [a, b] = t.addMoments(c.id, [{ start_sec: 2, end_sec: 6 }, { start_sec: 10, end_sec: 14 }]);
    const r = await run();
    expect(r).toMatchObject({ measured: 2, skipped: 0, failed: 0, bands: { locked: 2, stabilize: 0, shaky: 0 }, errors: [] });
    expect(calls).toEqual([
      { file: '/v/c1.mp4', startSec: 2, durationSec: 4, fps: 30 },
      { file: '/v/c1.mp4', startSec: 10, durationSec: 4, fps: 30 },
    ]);
    const m = highlights.findByClip(c.id).find((h) => h.id === a)!;
    expect(m).toMatchObject({ shake_score: 0, motion_start_sec: 2, motion_end_sec: 6 });
    expect(isMeasured(m)).toBe(true);
    expect(b).toBeGreaterThan(0);
  });

  it('is resumable: measured moments are skipped, --force redoes them', async () => {
    const c = t.addClip();
    t.addMoments(c.id, [{}, {}]);
    await run();
    calls.length = 0;
    expect(await run()).toMatchObject({ measured: 0, skipped: 2 });
    expect(calls).toHaveLength(0);
    expect(await run({ force: true })).toMatchObject({ measured: 2, skipped: 0 });
  });

  it('a trimmed moment is stale and re-measured; an untouched one is not', async () => {
    const c = t.addClip();
    const [a] = t.addMoments(c.id, [{ start_sec: 2, end_sec: 6 }, { start_sec: 10, end_sec: 14 }]);
    await run();
    db.prepare('UPDATE highlights SET start_sec = 3 WHERE id = ?').run(a);
    expect(isMeasured(highlights.findByClip(c.id).find((h) => h.id === a)!)).toBe(false);
    calls.length = 0;
    expect(await run()).toMatchObject({ measured: 1, skipped: 1 });
    expect(calls).toEqual([{ file: '/v/c1.mp4', startSec: 3, durationSec: 3, fps: 25 }]);
  });

  it('never changes ranges, status, tier or speed (protected moments included)', async () => {
    const c = t.addClip();
    const [a] = t.addMoments(c.id, [{ start_sec: 2, end_sec: 6 }]);
    db.prepare("UPDATE highlights SET status = 'confirmed', user_tier = 'hero', speed = 0.5 WHERE id = ?").run(a);
    const before = db.prepare('SELECT id, clip_id, start_sec, end_sec, status, tier, user_tier, speed, ai_start_sec, ai_end_sec FROM highlights').all();
    await run();
    expect(db.prepare('SELECT id, clip_id, start_sec, end_sec, status, tier, user_tier, speed, ai_start_sec, ai_end_sec FROM highlights').all()).toEqual(before);
    expect(highlights.findByClip(c.id)[0].shake_score).toBe(0);
  });

  it('falls back to the proxy when the original is missing, and fails when both are', async () => {
    const c = t.addClip();
    t.addMoments(c.id, [{}]);
    db.prepare("UPDATE clips SET proxy_path = '/p/c1.mp4' WHERE id = ?").run(c.id);
    const r = await measureClips(clips.listByProject(t.projectId), { highlights },
      { cfg, source: staticSource(calls), exists: (p) => p === '/p/c1.mp4' });
    expect(r.measured).toBe(1);
    expect(calls[0].file).toMatch(/p\/c1\.mp4$/);
    db.prepare('UPDATE highlights SET shake_score = NULL').run();
    const r2 = await measureClips(clips.listByProject(t.projectId), { highlights }, { cfg, source: staticSource(calls), exists: () => false });
    expect(r2).toMatchObject({ measured: 0, failed: 1 });
    expect(r2.errors[0].message).toMatch(/Neither the original nor the proxy/);
  });

  it('a failing decode counts as failed and the run goes on', async () => {
    const c = t.addClip();
    t.addMoments(c.id, [{}, {}]);
    let n = 0;
    const flaky: FrameSource = async (req) => { if (n++ === 0) throw new Error('boom'); return staticSource(calls)(req); };
    const r = await run({ source: flaky });
    expect(r).toMatchObject({ measured: 1, failed: 1 });
    expect(r.errors).toHaveLength(1);
  });

  it('skips hidden clips', async () => {
    const c = t.addClip();
    t.addMoments(c.id, [{}]);
    db.prepare('UPDATE clips SET hidden = 1 WHERE id = ?').run(c.id);
    expect(await run()).toMatchObject({ measured: 0, skipped: 0, failed: 0 });
  });
});
