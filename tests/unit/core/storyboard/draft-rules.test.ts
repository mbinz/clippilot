import { describe, it, expect, beforeEach } from 'vitest';
import { setup } from './_helpers.js';
import { draftWarnings, type RuleMoment } from '../../../../src/core/storyboard/rules.js';
import { DraftValidationError, type Draft } from '../../../../src/core/storyboard/schema.js';
import { HighlightRepository } from '../../../../src/db/repositories/highlight.repository.js';

const mo = (id: number, o: Partial<RuleMoment> = {}): RuleMoment => ({
  id, status: 'proposed', dup_group: null, tier: 'solid', user_tier: null, role: 'detail', start_sec: 0, end_sec: 4, speed: 1,
  speech: null, jitter: { score: 0.2, band: 'locked' }, motion: { camera: 0, change: 0 }, shakes: [], ...o,
});
const shaky = { score: 3, band: 'shaky' as const };
const shake = (confidence: 'high' | 'low') => ({ start: 1, end: 1.5, peak_at: 1.2, strength: 40, jump_pct: 3, jump_px: 58, confidence, moving_scene: false });
const draft = (...ids: (number | undefined)[]): Draft => ({ scenes: [{ name: 'S', panels: ids.map((id, i) => ({ intent: `p${i}`, moment_id: id })) }] });
const brief = (must: number[]) => ({ target_sec: 60, audience: 'a', mood: '', ending: '', must_have: must.map((id) => ({ moment_id: id, text: 't' })) });

describe('draftWarnings - shaky moments', () => {
  it('shaky_alternative: a shaky moment used although a calmer one exists in its dup group', () => {
    const w = draftWarnings(draft(1), [mo(1, { dup_group: 7, jitter: shaky }), mo(2, { dup_group: 7 }), mo(3, { dup_group: 8 })], null);
    expect(w).toEqual([expect.objectContaining({ panel: { scene: 1, panel: 1 }, moment_id: 1, type: 'shaky_alternative', alternatives: [2] })]);
    expect(w[0]!.message).toMatch(/Moment 1.*shaky.*2/);
  });

  it('a calmer alternative is not shaky, has no high-confidence shake and is not rejected (low-confidence shakes are fine)', () => {
    const moments = [
      mo(1, { dup_group: 7, jitter: shaky }),
      mo(2, { dup_group: 7, jitter: shaky }),
      mo(3, { dup_group: 7, shakes: [shake('high')] }),
      mo(4, { dup_group: 7, status: 'rejected' }),
      mo(5, { dup_group: 7, shakes: [shake('low')] }),
    ];
    const w = draftWarnings(draft(1), moments, null);
    expect(w[0]).toMatchObject({ type: 'shaky_alternative', alternatives: [5] });
  });

  it('no warning for a calm moment, or for a shaky one that is neither starred nor a must-have and has no alternative', () => {
    expect(draftWarnings(draft(1), [mo(1, { dup_group: 7 }), mo(2, { dup_group: 7 })], null)).toEqual([]);
    expect(draftWarnings(draft(1), [mo(1, { jitter: shaky })], null)).toEqual([]);
  });

  it('shaky_kept: shaky, no calmer alternative, and starred', () => {
    const w = draftWarnings(draft(1), [mo(1, { jitter: shaky, user_tier: 'hero' })], null);
    expect(w).toEqual([expect.objectContaining({ moment_id: 1, type: 'shaky_kept' })]);
    expect(draftWarnings(draft(1), [mo(1, { jitter: shaky, tier: 'hero' })], null)).toHaveLength(1);
    expect(draftWarnings(draft(1), [mo(1, { jitter: shaky, tier: 'hero', user_tier: 'solid' })], null)).toEqual([]);
  });

  it('shaky_kept: shaky, no calmer alternative, and a brief must-have (by moment id)', () => {
    const w = draftWarnings(draft(1), [mo(1, { jitter: shaky })], brief([1]));
    expect(w).toEqual([expect.objectContaining({ type: 'shaky_kept' })]);
    expect(draftWarnings(draft(1), [mo(1, { jitter: shaky })], brief([5]))).toEqual([]);
  });

  it('with a calmer alternative it is shaky_alternative even when starred (never both)', () => {
    const w = draftWarnings(draft(1), [mo(1, { dup_group: 7, jitter: shaky, user_tier: 'hero' }), mo(2, { dup_group: 7 })], brief([1]));
    expect(w.map((x) => x.type)).toEqual(['shaky_alternative']);
  });

  it('names the panel by scene and panel number (1-based); panels without a moment are skipped', () => {
    const d: Draft = { scenes: [
      { name: 'A', panels: [{ intent: 'x', moment_id: 2 }] },
      { name: 'B', panels: [{ intent: 'gap' }, { intent: 'y', candidates: [1, 2] }, { intent: 'z', moment_id: 1 }] },
    ] };
    const w = draftWarnings(d, [mo(1, { jitter: shaky, user_tier: 'hero' }), mo(2)], null);
    expect(w).toHaveLength(1);
    expect(w[0]!.panel).toEqual({ scene: 2, panel: 3 });
  });
});

describe('draftWarnings - too long', () => {
  it('a moment playing longer than 8 s gets too_long', () => {
    const w = draftWarnings(draft(1, 2), [mo(1, { end_sec: 8 }), mo(2, { end_sec: 8.5 })], null);
    expect(w).toEqual([expect.objectContaining({ moment_id: 2, type: 'too_long', panel: { scene: 1, panel: 2 } })]);
    expect(w[0]!.message).toMatch(/8\.5 s/);
  });

  it('uses the played length (speed)', () => {
    expect(draftWarnings(draft(1), [mo(1, { end_sec: 5, speed: 0.5 })], null)).toHaveLength(1);
    expect(draftWarnings(draft(1), [mo(1, { end_sec: 12, speed: 1 })], null)).toHaveLength(1);
  });

  it('speech lifts the limit to 20 s', () => {
    expect(draftWarnings(draft(1), [mo(1, { end_sec: 15, speech: 'hello' })], null)).toEqual([]);
    expect(draftWarnings(draft(1), [mo(1, { end_sec: 21, speech: 'hello' })], null)).toHaveLength(1);
    expect(draftWarnings(draft(1), [mo(1, { end_sec: 15, speech: '  ' })], null)).toHaveLength(1);
  });

  it('action (role action, frame change >= 0.03 or camera motion >= 2 %/s) lifts the limit to 20 s', () => {
    expect(draftWarnings(draft(1), [mo(1, { end_sec: 15, role: 'action' })], null)).toEqual([]);
    expect(draftWarnings(draft(1), [mo(1, { end_sec: 15, motion: { camera: 0, change: 0.03 } })], null)).toEqual([]);
    expect(draftWarnings(draft(1), [mo(1, { end_sec: 15, motion: { camera: 2, change: 0 } })], null)).toEqual([]);
    expect(draftWarnings(draft(1), [mo(1, { end_sec: 15, motion: { camera: 1.9, change: 0.029 } })], null)).toHaveLength(1);
    expect(draftWarnings(draft(1), [mo(1, { end_sec: 25, role: 'action' })], null)).toHaveLength(1);
  });
});

describe('applyDraft warnings', () => {
  let t: ReturnType<typeof setup>;
  let cutId: number;
  let clipId: number;
  let m: number[];
  beforeEach(() => {
    t = setup();
    cutId = t.svc.createCut(t.projectId, 'Main').id;
    clipId = t.addClip({ fps: 60, duration: 60 }).id;
    m = t.addMoments(clipId, [{ start_sec: 1, end_sec: 5 }, { start_sec: 10, end_sec: 25 }, { start_sec: 30, end_sec: 40 }]);
  });

  it('returns warnings (long moment) and still applies the draft', () => {
    const res = t.svc.applyDraft(cutId, { scenes: [{ name: 'S', panels: [{ intent: 'a', moment_id: m[0] }, { intent: 'b', moment_id: m[1] }] }] }, { mode: 'replace' });
    expect(res.panels).toBe(2);
    expect(res.warnings).toEqual([expect.objectContaining({ panel: { scene: 1, panel: 2 }, moment_id: m[1], type: 'too_long' })]);
    expect(t.svc.getCut(cutId)!.totals.panels).toBe(2);
  });

  it('a draft without problems has an empty warnings list', () => {
    expect(t.svc.applyDraft(cutId, { scenes: [{ name: 'S', panels: [{ intent: 'a', moment_id: m[0] }] }] }, { mode: 'append' }).warnings).toEqual([]);
  });

  it('no warnings for panels the user placed and replace mode kept', () => {
    const scene = t.svc.addScene(cutId, 'Mine');
    const p = t.svc.addPanel(scene.id, { intent: 'mine' });
    t.svc.placeMoment(p.id, m[2]!); // 10 s moment, user-placed
    const res = t.svc.applyDraft(cutId, { scenes: [{ name: 'Mine', panels: [{ intent: 'a', moment_id: m[0] }] }] }, { mode: 'replace' });
    expect(res.panels).toBe(2);
    expect(res.warnings).toEqual([]);
  });

  it('judges the moment as applied: a trimmed range is the length', () => {
    const res = t.svc.applyDraft(cutId, { scenes: [{ name: 'S', panels: [{ intent: 'b', moment_id: m[1], start_sec: 10, end_sec: 14 }] }] }, { mode: 'replace' });
    expect(res.warnings).toEqual([]);
  });
});

describe('draft cut_out', () => {
  let t: ReturnType<typeof setup>;
  let cutId: number;
  let clipId: number;
  let m: number[];
  const errorsOf = (draft: unknown): string[] => {
    try { t.svc.applyDraft(cutId, draft, { mode: 'replace' }); } catch (e) { expect(e).toBeInstanceOf(DraftValidationError); return (e as DraftValidationError).errors; }
    throw new Error('expected DraftValidationError');
  };
  beforeEach(() => {
    t = setup();
    cutId = t.svc.createCut(t.projectId, 'Main').id;
    clipId = t.addClip({ fps: 60, duration: 60 }).id;
    m = t.addMoments(clipId, [{ start_sec: 2, end_sec: 12 }, { start_sec: 20, end_sec: 30 }]);
  });

  it('trims the moment, creates the sibling and its panel right behind; both are AI decisions', () => {
    const res = t.svc.applyDraft(cutId, { scenes: [{ name: 'S', panels: [
      { intent: 'wave', moment_id: m[0], cut_out: [5, 7] },
      { intent: 'next', moment_id: m[1] },
    ] }] }, { mode: 'replace' });
    expect(res).toMatchObject({ scenes: 1, panels: 3 });
    const panels = t.svc.getCut(cutId)!.scenes[0]!.panels;
    expect(panels.map((p) => [p.intent, p.start_sec, p.end_sec, p.source])).toEqual([
      ['wave', 2, 5, 'ai'], ['wave', 7, 12, 'ai'], ['next', 20, 30, 'ai'],
    ]);
    const hl = new HighlightRepository(t.db);
    expect(hl.protectionReasons(m[0]!)).toEqual([]);
    expect(hl.protectionReasons(panels[1]!.moment_id!)).toEqual([]);
    expect(t.svc.getCut(cutId)!.scenes[0]!.panels[1]!.moment!.split_of).toBe(m[0]);
  });

  it('with the panel\'s own start / end and speed: the cut applies to the range as drafted', () => {
    t.svc.applyDraft(cutId, { scenes: [{ name: 'S', panels: [{ intent: 'wave', moment_id: m[0], start_sec: 3, end_sec: 11, speed: 0.5, cut_out: [6, 8] }] }] }, { mode: 'replace' });
    const panels = t.svc.getCut(cutId)!.scenes[0]!.panels;
    expect(panels.map((p) => [p.start_sec, p.end_sec, p.speed])).toEqual([[3, 6, 0.5], [8, 11, 0.5]]);
    expect(new HighlightRepository(t.db).protectionReasons(panels[1]!.moment_id!)).toEqual([]);
  });

  it('is one undo step that restores both moments and panels', () => {
    t.svc.command(cutId, 'draft', () => t.svc.applyDraft(cutId, { scenes: [{ name: 'S', panels: [{ intent: 'wave', moment_id: m[0], cut_out: [5, 7] }] }] }, { mode: 'replace' }));
    t.svc.undo(cutId);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM highlights').get()).toEqual({ n: 2 });
    expect(t.db.prepare('SELECT start_sec, end_sec, ai_start_sec, ai_end_sec FROM highlights WHERE id = ?').get(m[0])).toEqual({ start_sec: 2, end_sec: 12, ai_start_sec: 2, ai_end_sec: 12 });
    expect(t.svc.getCut(cutId)!.scenes).toEqual([]);
  });

  it('validation: needs moment_id, inside the moment, both parts >= 1 s, a user-touched moment is refused', () => {
    t.svc.trimMoment(m[1]!, 21, 30);
    const errors = errorsOf({ scenes: [{ name: 'S', panels: [
      { intent: 'a', moment_id: m[0], cut_out: [1, 5] },
      { intent: 'b', moment_id: m[0], cut_out: [2.5, 5] },
      { intent: 'c', moment_id: m[0], cut_out: [5, 11.5] },
      { intent: 'd', moment_id: m[0], cut_out: [7, 5] },
      { intent: 'e', moment_id: m[1], cut_out: [24, 26] },
      { intent: 'f', cut_out: [5, 6] },
      { intent: 'g', moment_id: m[0], start_sec: 4, end_sec: 10, cut_out: [3, 6] },
    ] }] });
    expect(errors).toHaveLength(7);
    expect(errors.join('\n')).toMatch(/panels\.0.*cut_out.*inside/);
    expect(errors.join('\n')).toMatch(/panels\.1.*at least 1/);
    expect(errors.join('\n')).toMatch(/panels\.2.*at least 1/);
    expect(errors.join('\n')).toMatch(/panels\.3.*before/);
    expect(errors.join('\n')).toMatch(/panels\.4.*protected/);
    expect(errors.join('\n')).toMatch(/panels\.5.*moment_id/);
    expect(errors.join('\n')).toMatch(/panels\.6.*inside/);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM highlights').get()).toEqual({ n: 2 });
  });
});
