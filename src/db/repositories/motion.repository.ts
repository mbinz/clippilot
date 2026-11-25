import type Database from 'better-sqlite3';
import type { MotionCurve, Shake } from '../../core/motion/curve.js';

export interface StoredCurve extends MotionCurve {
  medianResidual: number;
  continuous: boolean;
}

const blob = (a: Int8Array | Float32Array): Buffer => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
const int8 = (b: Buffer): Int8Array => new Int8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
const float32 = (b: Buffer): Float32Array => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));

interface CurveRow {
  fps: number; width: number; src_width: number; dx: Buffer; dy: Buffer; change: Buffer; median_residual: number; continuous: number;
}
type ShakeRow = Omit<Shake, 'moving_scene'> & { moving_scene: number };

export class MotionRepository {
  constructor(private db: Database.Database) {}

  /** Store the clip's curve and shakes, replacing what was there. */
  save(clipId: number, m: { curve: MotionCurve; medianResidual: number; continuous: boolean; shakes: Shake[] }): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM motion_curves WHERE clip_id = ?').run(clipId);
      this.db.prepare('DELETE FROM shakes WHERE clip_id = ?').run(clipId);
      const c = m.curve;
      this.db.prepare(`INSERT INTO motion_curves (clip_id, fps, frames, width, src_width, dx, dy, change, median_residual, continuous)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(clipId, c.fps, c.dx.length, c.width, c.srcWidth, blob(c.dx), blob(c.dy), blob(c.change), m.medianResidual, m.continuous ? 1 : 0);
      const ins = this.db.prepare(`INSERT INTO shakes (clip_id, start_sec, end_sec, peak_sec, peak, jump_pct, jump_px, disagreement, moving_scene, confidence)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const k of m.shakes) {
        ins.run(clipId, k.start_sec, k.end_sec, k.peak_sec, k.peak, k.jump_pct, k.jump_px, k.disagreement, k.moving_scene ? 1 : 0, k.confidence);
      }
    })();
  }

  getCurve(clipId: number): StoredCurve | null {
    const r = this.db.prepare('SELECT * FROM motion_curves WHERE clip_id = ?').get(clipId) as CurveRow | undefined;
    if (!r) return null;
    return {
      fps: r.fps, width: r.width, srcWidth: r.src_width, dx: int8(r.dx), dy: int8(r.dy), change: float32(r.change),
      medianResidual: r.median_residual, continuous: r.continuous === 1,
    };
  }

  getShakes(clipId: number): Shake[] {
    return (this.db.prepare(`SELECT start_sec, end_sec, peak_sec, peak, jump_pct, jump_px, disagreement, moving_scene, confidence
      FROM shakes WHERE clip_id = ? ORDER BY start_sec`).all(clipId) as ShakeRow[])
      .map((r) => ({ ...r, moving_scene: r.moving_scene === 1 }));
  }

  clipIdsWithCurve(): number[] {
    return (this.db.prepare('SELECT clip_id FROM motion_curves ORDER BY clip_id').all() as { clip_id: number }[]).map((r) => r.clip_id);
  }
}
