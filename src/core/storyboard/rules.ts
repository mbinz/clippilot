import type { Brief, Draft } from './schema.js';

/** The slice of a moment row (`StoryboardService.listMoments`) the draft rules look at. */
export interface RuleMoment {
  id: number;
  status: string;
  dup_group: number | null;
  tier: string;
  user_tier: string | null;
  role: string | null;
  start_sec: number;
  end_sec: number;
  speed: number;
  speech: string | null;
  jitter: { score: number; band: string } | null;
  motion: { camera: number; change: number } | null;
  shakes: { confidence: string }[] | null;
}

export type DraftWarningType = 'shaky_alternative' | 'shaky_kept' | 'too_long';

export interface DraftWarning {
  /** 1-based scene and panel number in the draft. */
  panel: { scene: number; panel: number };
  moment_id: number;
  type: DraftWarningType;
  message: string;
  /** Calmer moments of the same duplicate group (`shaky_alternative`). */
  alternatives?: number[];
}

/** A moment longer than this (played) is too long ... */
export const MAX_PLAYED_SEC = 8;
/** ... unless it carries speech or is an action moment, which may run this long. */
export const MAX_PLAYED_SEC_ACTION = 20;
const ACTION_CHANGE = 0.03;
const ACTION_CAMERA = 2;

const isShaky = (m: RuleMoment): boolean => m.jitter?.band === 'shaky';
const isStar = (m: RuleMoment): boolean => (m.user_tier ?? m.tier) === 'hero';
const hasHighShake = (m: RuleMoment): boolean => !!m.shakes?.some((k) => k.confidence === 'high');
const isAction = (m: RuleMoment): boolean => m.role === 'action'
  || (m.motion?.change ?? 0) >= ACTION_CHANGE || (m.motion?.camera ?? 0) >= ACTION_CAMERA;

/**
 * Draft rules [D-7] as warnings (never errors): a shaky moment used although a calmer one of its duplicate group
 * exists, a shaky moment kept because it is a ★ or a brief must-have, a moment playing too long. `moments` must be the
 * moments as applied (ranges, speed), so the lengths are the played ones. Only panels of the draft are judged.
 */
export function draftWarnings(draft: Draft, moments: RuleMoment[], brief: Brief | null): DraftWarning[] {
  const byId = new Map(moments.map((m) => [m.id, m]));
  const mustHave = new Set((brief?.must_have ?? []).flatMap((h) => (h.moment_id === undefined ? [] : [h.moment_id])));
  const warnings: DraftWarning[] = [];
  draft.scenes.forEach((scene, si) => scene.panels.forEach((panel, pi) => {
    const m = panel.moment_id === undefined ? undefined : byId.get(panel.moment_id);
    if (!m) return;
    const at = { scene: si + 1, panel: pi + 1 };
    const add = (type: DraftWarningType, message: string, alternatives?: number[]) =>
      warnings.push({ panel: at, moment_id: m.id, type, message, ...(alternatives ? { alternatives } : {}) });

    if (isShaky(m)) {
      const calmer = m.dup_group === null ? [] : moments
        .filter((o) => o.id !== m.id && o.dup_group === m.dup_group && o.status !== 'rejected' && !isShaky(o) && !hasHighShake(o))
        .map((o) => o.id);
      if (calmer.length) {
        add('shaky_alternative', `Moment ${m.id} is shaky; calmer moment(s) of the same shot exist: ${calmer.join(', ')}`, calmer);
      } else if (isStar(m) || mustHave.has(m.id)) {
        add('shaky_kept', `Moment ${m.id} is shaky but kept (${isStar(m) ? '★' : 'brief must-have'}) and has no calmer alternative`);
      }
    }

    const played = (m.end_sec - m.start_sec) / m.speed;
    const exempt = !!m.speech?.trim() || isAction(m);
    const limit = exempt ? MAX_PLAYED_SEC_ACTION : MAX_PLAYED_SEC;
    if (played > limit + 1e-9) {
      add('too_long', `Moment ${m.id} plays ${Math.round(played * 10) / 10} s (limit ${limit} s${exempt ? '' : `; ${MAX_PLAYED_SEC_ACTION} s with speech or action`})`);
    }
  }));
  return warnings;
}
