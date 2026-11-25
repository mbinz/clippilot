import { describe, it, expect } from 'vitest';
import { frameEndReached, frameSec, frameLoopTarget } from '../../../web/src/board/frameWatch.js';

describe('frameSec', () => {
  it('uses the clip fps, defaulting to 1/25', () => {
    expect(frameSec(50)).toBeCloseTo(0.02, 6);
    expect(frameSec(null)).toBeCloseTo(0.04, 6);
    expect(frameSec(undefined)).toBeCloseTo(0.04, 6);
    expect(frameSec(0)).toBeCloseTo(0.04, 6);
  });
});

describe('frameEndReached (the shown frame is the last one before the end)', () => {
  it('is false while a further frame still fits before the end', () => {
    expect(frameEndReached(6.9, 7.02, 0.04)).toBe(false);
    expect(frameEndReached(6.97, 7.02, 0.04)).toBe(false);
  });
  it('is true once the next frame would start at or after the end', () => {
    expect(frameEndReached(6.98, 7.02, 0.04)).toBe(true);
    expect(frameEndReached(7.02, 7.02, 0.04)).toBe(true);
    expect(frameEndReached(7.3, 7.02, 0.04)).toBe(true);
  });
  it('tolerates float noise at the exact boundary', () => {
    expect(frameEndReached(7.02 - 0.04 - 1e-9, 7.02, 0.04)).toBe(true);
  });
});

describe('frameLoopTarget (loop decision per presented frame)', () => {
  it('loops back to a at the last frame before b', () => {
    expect(frameLoopTarget(6.98, 2, 7.02, false, 0.04)).toBe(2);
  });
  it('leaves the video alone mid-range and in free mode', () => {
    expect(frameLoopTarget(4, 2, 7.02, false, 0.04)).toBeNull();
    expect(frameLoopTarget(7.5, 2, 7.02, true, 0.04)).toBeNull();
  });
  it('keeps the a - 0.3 rule', () => {
    expect(frameLoopTarget(1.5, 2, 7.02, false, 0.04)).toBe(2);
    expect(frameLoopTarget(1.8, 2, 7.02, false, 0.04)).toBeNull();
  });
});
