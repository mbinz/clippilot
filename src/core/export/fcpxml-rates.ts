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
  { fps: 100,    num: 100,  den: 10000 },
];

const TOLERANCE = 0.01;

// ffprobe reports an *average* rate for VFR footage (e.g. GoPro 49.93 for 50p).
// Anything within this relative distance of a canonical rate is that rate.
const SNAP_RELATIVE_TOLERANCE = 0.005;

/** Snap a measured (possibly VFR-averaged) fps onto the nearest canonical rate; unchanged if none is close. */
export function snapFps(fps: number): number {
  let best: { fps: number; dist: number } | null = null;
  for (const r of RATE_TABLE) {
    const dist = Math.abs(r.fps - fps) / r.fps;
    if (dist <= SNAP_RELATIVE_TOLERANCE && (!best || dist < best.dist)) best = { fps: r.fps, dist };
  }
  return best ? best.fps : fps;
}

/**
 * Rate at which the frame field of an ffprobe timecode counts.
 *
 * HYPOTHESIS (2 data points, both Sony A7C II 100p): Resolve reads TC `06:37:54:72` as 23874.36 s and
 * `05:58:51:84` as 21531.42 s, i.e. frame field / 200 rather than / 100. So for fps > 50 the frame field
 * counts at 2x fps. Verified for 100p only; 59.94/60p and 120p are extrapolation.
 * Golden: tests/fixtures/resolve-golden/m1-fixture.fcpxml. Keep this rule isolated here.
 */
export function tcFrameFieldRate(nominalFps: number): number {
  return nominalFps > 50 ? nominalFps * 2 : nominalFps;
}

/**
 * Embedded timecode `HH:MM:SS:FF` as a frame count at the clip's own rate (non-drop-frame).
 * Integer arithmetic on the nominal rate; no float seconds.
 */
export function timecodeToSourceFrames(tc: string, fps: number): number {
  const m = tc.match(/^(\d+):(\d+):(\d+)[:;](\d+)$/);
  if (!m) throw new Error(`Invalid timecode: ${tc}. Expected HH:MM:SS:FF`);
  const nominal = Math.round(snapFps(fps));
  const [hh, mm, ss, ff] = m.slice(1).map(Number);
  return (hh * 3600 + mm * 60 + ss) * nominal + Math.round((ff * nominal) / tcFrameFieldRate(nominal));
}

/** Resolve-style format label: 1080p -> "1080p25", otherwise "3840x2160p25". Non-integer rates use 2398/2997/5994. */
export function formatName(width: number, height: number, fps: number): string {
  const snapped = snapFps(fps);
  const label = Number.isInteger(snapped) ? String(snapped) : String(Math.round(snapped * 100));
  const size = width === 1920 && height === 1080 ? '1080' : `${width}x${height}`;
  return `FFVideoFormat${size}p${label}`;
}

export function frameDurationFor(fps: number): { num: number; den: number } {
  const snapped = snapFps(fps);
  const match = RATE_TABLE.find(r => Math.abs(r.fps - snapped) < TOLERANCE);
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
