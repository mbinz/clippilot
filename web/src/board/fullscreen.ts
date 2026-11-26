// Pure layout of the full-screen compare (BE5). No React, no DOM.
// Tested in tests/unit/web/board-fullscreen.test.ts.

export interface Rect { x: number; y: number; w: number; h: number }

const safeAspect = (a: number): number => (Number.isFinite(a) && a > 0 ? a : 16 / 9);
const nat = (n: number): number => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/**
 * Two players side by side with the same height, as large as the view allows (`aspect` = width / height of each clip,
 * so portrait clips are < 1). Rects are relative to the view; the pair is centred.
 */
export function fitTwoUp(viewW: number, viewH: number, aspectL: number, aspectR: number, gap: number): { left: Rect; right: Rect } {
  const aL = safeAspect(aspectL);
  const aR = safeAspect(aspectR);
  const g = nat(gap);
  const h = nat(Math.min(viewH, (viewW - g) / (aL + aR)));
  const wL = nat(h * aL);
  const wR = nat(h * aR);
  const x0 = nat((viewW - (wL + g + wR)) / 2);
  const y = nat((viewH - h) / 2);
  return { left: { x: x0, y, w: wL, h }, right: { x: x0 + wL + g, y, w: wR, h } };
}

/** One player as large as the view allows, centred horizontally. */
export function fitOne(viewW: number, viewH: number, aspect: number): Rect {
  const a = safeAspect(aspect);
  const h = nat(Math.min(viewH, viewW / a));
  const w = nat(h * a);
  return { x: nat((viewW - w) / 2), y: nat((viewH - h) / 2), w, h };
}
