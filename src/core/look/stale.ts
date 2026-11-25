export type LookState = 'missing' | 'stale' | 'fresh';

/** Missing = no vector; stale = computed for another range than the moment has now (re-trimmed). */
export function lookState(h: { start_sec: number; end_sec: number; look_vec: Buffer | null; look_start_sec: number | null; look_end_sec: number | null }): LookState {
  if (!h.look_vec) return 'missing';
  return h.look_start_sec === h.start_sec && h.look_end_sec === h.end_sec ? 'fresh' : 'stale';
}
