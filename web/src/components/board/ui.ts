// Shared class strings for the board (ported from the mockup's .btn variants).
const BASE = 'rounded-lg border px-3 py-1.5 whitespace-nowrap cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed';
export const btn = `${BASE} bg-bd-s2 border-bd-line text-bd-text hover:border-bd-line2`;
export const btnIcon = `${BASE} bg-bd-s2 border-bd-line text-bd-text hover:border-bd-line2 !px-[9px]`;
export const btnPrimary = `${BASE} bg-bd-focus border-bd-focus text-bd-bg font-semibold`;
export const btnGhost = `${BASE} bg-transparent border-transparent text-bd-muted hover:text-bd-text`;
export const btnDanger = `${BASE} bg-bd-s2 border-bd-line text-bd-bad hover:border-bd-line2`;
export const sectionLabel = 'block text-[11px] uppercase tracking-[.06em] text-bd-dim mb-1.5';
export const tagAi = 'text-[10px] font-bold text-bd-ai border border-bd-ai rounded-[5px] px-1.5';
export const tagMine = 'text-[10px] font-bold text-bd-mine border border-bd-mine rounded-[5px] px-1.5';
export const fieldInput = 'w-full bg-bd-s2 border border-bd-line text-bd-text rounded-lg px-[9px] py-[7px] font-[inherit]';

/** Mockup's "first clause of the description" used as the intent of a panel created from a moment. */
export const intentFrom = (description: string): string => description.split(/[,.]/)[0].trim();
/** Primary button inside the amber panel drawer. */
export const btnAttn = `${BASE} bg-bd-attn border-bd-attn text-[#1d1400] font-semibold`;
export const kbd = 'text-[11px] text-bd-dim';

/** Reasons offered when a moment is rejected. */
export const REASONS = ['shake', 'blur', 'boring', 'duplicate', 'bad timing', 'other'];
