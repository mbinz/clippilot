import { describe, it, expect } from 'vitest';
import { fitTwoUp, fitOne } from '../../../web/src/board/fullscreen.js';

const R = 16 / 9;

describe('fitTwoUp (two players side by side, same height, as large as the view allows)', () => {
  it('two 16:9 clips in a wide view: width is the limit, both rects equal and centred', () => {
    const { left, right } = fitTwoUp(1920, 1080, R, R, 16);
    expect(left.h).toBe(right.h);
    expect(left.w).toBe(right.w);
    expect(left.h).toBe(535); // floor((1920 - 16) / 2 / (16/9))
    expect(left.w).toBe(951);
    expect(left.x).toBe(1); // (1920 - 1918) / 2
    expect(right.x).toBe(left.x + left.w + 16);
    expect(left.y).toBe(Math.floor((1080 - left.h) / 2));
  });

  it('height is the limit in a tall view; the pair is centred horizontally', () => {
    const { left, right } = fitTwoUp(2400, 500, R, R, 20);
    expect(left.h).toBe(500);
    expect(left.y).toBe(0);
    const total = left.w + 20 + right.w;
    expect(total).toBeLessThanOrEqual(2400);
    expect(left.x).toBe(Math.floor((2400 - total) / 2));
  });

  it('a portrait clip next to a landscape one: same height, widths follow the aspects', () => {
    const { left, right } = fitTwoUp(1600, 900, 9 / 16, R, 16);
    expect(left.h).toBe(right.h);
    expect(left.w / left.h).toBeCloseTo(9 / 16, 1);
    expect(right.w / right.h).toBeCloseTo(R, 1);
    expect(left.w + 16 + right.w).toBeLessThanOrEqual(1600);
    expect(left.h).toBeLessThanOrEqual(900);
  });

  it('two portrait clips fill the height', () => {
    const { left, right } = fitTwoUp(1920, 1080, 9 / 16, 9 / 16, 16);
    expect(left.h).toBe(1080);
    expect(right.x).toBe(left.x + left.w + 16);
  });

  it('never negative or NaN in a tiny view or with a bad aspect', () => {
    for (const [w, h, a, b] of [[10, 10, R, R], [0, 0, R, R], [800, 600, 0, R], [800, 600, NaN, -1]] as const) {
      const { left, right } = fitTwoUp(w, h, a, b, 16);
      for (const v of [left.x, left.y, left.w, left.h, right.x, right.y, right.w, right.h]) {
        expect(Number.isFinite(v) && v >= 0).toBe(true);
      }
    }
  });
});

describe('fitOne (a single player)', () => {
  it('fits the aspect into the view', () => {
    expect(fitOne(1600, 600, R)).toEqual({ x: Math.floor((1600 - 1066) / 2), y: 0, w: 1066, h: 600 });
    expect(fitOne(800, 900, R)).toMatchObject({ w: 800, h: 450 });
  });
  it('portrait', () => {
    expect(fitOne(1600, 900, 9 / 16)).toMatchObject({ h: 900, w: 506 });
  });
});
