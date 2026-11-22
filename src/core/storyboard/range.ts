import { speedAllowed } from '../analyze/highlights.js';

/** Default output length of a panel, in seconds. */
export const PANEL_DEFAULT_SEC = 4;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Default source window and speed for putting a moment on a panel: the moment's suggested speed when the clip's
 * frame rate allows it (else 1), and a window of at most PANEL_DEFAULT_SEC x speed source seconds centred on the moment.
 */
export function defaultRange(
  moment: { start_sec: number; end_sec: number; suggested_speed: number },
  clip: { fps: number | null | undefined },
): { start_sec: number; end_sec: number; speed: number } {
  const speed = speedAllowed(moment.suggested_speed, clip.fps) ? moment.suggested_speed : 1;
  const len = moment.end_sec - moment.start_sec;
  const want = PANEL_DEFAULT_SEC * speed;
  if (len <= want) return { start_sec: moment.start_sec, end_sec: moment.end_sec, speed };
  const mid = (moment.start_sec + moment.end_sec) / 2;
  return { start_sec: round2(mid - want / 2), end_sec: round2(mid + want / 2), speed };
}
