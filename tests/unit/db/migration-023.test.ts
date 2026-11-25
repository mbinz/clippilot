import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../src/db/migrations/runner.js';
import { MotionRepository } from '../../../src/db/repositories/motion.repository.js';
import type { MotionCurve, Shake } from '../../../src/core/motion/curve.js';

function db() {
  const d = new Database(':memory:');
  d.pragma('foreign_keys = ON');
  runMigrations(d);
  d.prepare("INSERT INTO projects (name) VALUES ('p')").run();
  d.prepare("INSERT INTO clips (project_id, file_path, file_hash, file_size, duration_sec) VALUES (1, '/a.mp4', 'h', 1, 30)").run();
  return d;
}

const curve: MotionCurve = {
  fps: 25, width: 320, srcWidth: 1920,
  dx: Int8Array.from([1, -2, 3, -16, 16]), dy: Int8Array.from([0, 0, -1, 5, -5]), change: Float32Array.from([0.01, 0.5, 0, 0.25, 1]),
};
const shake: Shake = { start_sec: 1.2, end_sec: 1.8, peak_sec: 1.5, peak: 33.3, jump_pct: 2.5, jump_px: 48, disagreement: 0.12, moving_scene: false, confidence: 'high' };

describe('migration 023 - motion curves and shakes', () => {
  it('creates motion_curves and shakes', () => {
    const d = db();
    const cols = (t: string) => (d.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
    expect(cols('motion_curves')).toEqual(['clip_id', 'fps', 'frames', 'width', 'src_width', 'dx', 'dy', 'change', 'median_residual', 'continuous', 'measured_at']);
    expect(cols('shakes')).toEqual(['id', 'clip_id', 'start_sec', 'end_sec', 'peak_sec', 'peak', 'jump_pct', 'jump_px', 'disagreement', 'moving_scene', 'confidence']);
  });
});

describe('MotionRepository', () => {
  it('round-trips a curve (Int8 / Float32 blobs) with its shakes; saving again replaces both', () => {
    const d = db();
    const r = new MotionRepository(d);
    expect(r.getCurve(1)).toBeNull();
    r.save(1, { curve, medianResidual: 1.5, continuous: false, shakes: [shake] });
    const got = r.getCurve(1)!;
    expect(Array.from(got.dx)).toEqual([1, -2, 3, -16, 16]);
    expect(Array.from(got.dy)).toEqual([0, 0, -1, 5, -5]);
    expect(Array.from(got.change)).toEqual(Array.from(curve.change));
    expect(got).toMatchObject({ fps: 25, width: 320, srcWidth: 1920, medianResidual: 1.5, continuous: false });
    expect(r.getShakes(1)).toEqual([shake]);
    r.save(1, { curve, medianResidual: 0, continuous: true, shakes: [] });
    expect(r.getCurve(1)!.continuous).toBe(true);
    expect(r.getShakes(1)).toEqual([]);
    expect(r.clipIdsWithCurve()).toEqual([1]);
  });
  it('deleting the clip deletes its curve and shakes', () => {
    const d = db();
    const r = new MotionRepository(d);
    r.save(1, { curve, medianResidual: 0, continuous: false, shakes: [shake] });
    d.prepare('DELETE FROM clips WHERE id = 1').run();
    expect(r.getCurve(1)).toBeNull();
    expect(d.prepare('SELECT COUNT(*) AS n FROM shakes').get()).toEqual({ n: 0 });
  });
});
