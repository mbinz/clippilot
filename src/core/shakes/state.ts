import type { HighlightRecord, ShakeStatus } from '../../db/repositories/highlight.repository.js';

const RANGE_EPS = 0.01;

/**
 * The shake fit status of a moment as the outputs show it: the stored one while the range is the one it was decided on,
 * otherwise "not checked" (null), e.g. after a trim or an undo.
 */
export function shakeStateOf(
  m: Pick<HighlightRecord, 'start_sec' | 'end_sec' | 'shake_status' | 'shake_note' | 'shake_checked_start' | 'shake_checked_end'>,
): { shake_status: ShakeStatus | null; shake_note: string | null } {
  const valid = m.shake_status !== null && m.shake_status !== undefined
    && m.shake_checked_start !== null && m.shake_checked_end !== null
    && Math.abs(m.shake_checked_start - m.start_sec) <= RANGE_EPS && Math.abs(m.shake_checked_end - m.end_sec) <= RANGE_EPS;
  return valid ? { shake_status: m.shake_status, shake_note: m.shake_note ?? null } : { shake_status: null, shake_note: null };
}
