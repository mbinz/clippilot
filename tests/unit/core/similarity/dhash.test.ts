import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { dhash, hamming } from '../../../../src/core/similarity/dhash.js';

/** 64x64 horizontal gradient, optionally inverted (right to left). */
async function gradient(invert: boolean): Promise<Buffer> {
  const w = 64, h = 64;
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.round(((invert ? w - 1 - x : x) / (w - 1)) * 255);
      raw.fill(v, (y * w + x) * 3, (y * w + x) * 3 + 3);
    }
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

describe('dhash', () => {
  it('identical images hash to distance 0', async () => {
    const a = await dhash(await gradient(false));
    const b = await dhash(await gradient(false));
    expect(typeof a).toBe('bigint');
    expect(hamming(a, b)).toBe(0);
  });

  it('inverted image is far away', async () => {
    const a = await dhash(await gradient(false));
    const b = await dhash(await gradient(true));
    expect(hamming(a, b)).toBeGreaterThan(32);
  });

  it('hamming counts differing bits', () => {
    expect(hamming(0n, 0b1011n)).toBe(3);
    expect(hamming(2n ** 63n, 0n)).toBe(1);
  });
});
