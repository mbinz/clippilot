// Canonical FCPXML frame durations (num/den per frame) per Apple's spec.
// Non-integer rates use the exact NTSC pulldown rationals (1001/N).
const RATE_TABLE: { fps: number; num: number; den: number }[] = [
  { fps: 23.976, num: 1001, den: 24000 },
  { fps: 24,     num: 100,  den: 2400  },
  { fps: 25,     num: 100,  den: 2500  },
  { fps: 29.97,  num: 1001, den: 30000 },
  { fps: 30,     num: 100,  den: 3000  },
  { fps: 50,     num: 100,  den: 5000  },
  { fps: 59.94,  num: 1001, den: 60000 },
  { fps: 60,     num: 100,  den: 6000  },
];

const TOLERANCE = 0.01;

export function frameDurationFor(fps: number): { num: number; den: number } {
  const match = RATE_TABLE.find(r => Math.abs(r.fps - fps) < TOLERANCE);
  if (match) return { num: match.num, den: match.den };
  // Fallback for unlisted rates: rational with 1000-denominator
  const num = 1000;
  const den = Math.round(fps * 1000);
  return { num, den };
}

/** Encode N frames as a FCPXML time attribute string (e.g. "100/2500s"). */
export function timeAttr(frames: number, fps: number): string {
  if (frames === 0) return '0s';
  const { num, den } = frameDurationFor(fps);
  return `${frames * num}/${den}s`;
}

/** Round fps to the nearest canonical value for display (e.g. 25.0 → "25"). */
export function canonicalFpsName(fps: number): string {
  const match = RATE_TABLE.find(r => Math.abs(r.fps - fps) < TOLERANCE);
  if (match) return String(match.fps).replace('.', '').padEnd(2, '');
  return String(Math.round(fps));
}

/** Return the integer frame count closest to the canonical rate for a given detected fps. */
export function normalizedFps(fps: number): number {
  const match = RATE_TABLE.find(r => Math.abs(r.fps - fps) < TOLERANCE);
  return match ? match.fps : fps;
}
