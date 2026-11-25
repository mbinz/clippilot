import { describe, it, expect, beforeEach } from 'vitest';
import { setup } from '../storyboard/_helpers.js';
import { HighlightRepository } from '../../../../src/db/repositories/highlight.repository.js';
import { MotionRepository } from '../../../../src/db/repositories/motion.repository.js';
import { TranscriptRepository } from '../../../../src/db/repositories/transcript.repository.js';
import { fixShakes, type ShakeVerifier } from '../../../../src/core/shakes/index.js';
import type { VerifyRequest } from '../../../../src/core/shakes/verify.js';
import type { Shake } from '../../../../src/core/motion/curve.js';

type T = ReturnType<typeof setup>;

const shake = (start_sec: number, end_sec: number, confidence: 'high' | 'low' = 'high'): Shake => ({
  start_sec, end_sec, peak_sec: start_sec, peak: 5, jump_pct: 1, jump_px: 20, disagreement: 0.1, moving_scene: false, confidence,
});

/** Fake verifier: answers from a queue (strings, or a function), records every request. */
function fake(answers: (string | ((r: VerifyRequest) => string))[] | 'yes' | 'no'): ShakeVerifier & { calls: VerifyRequest[] } {
  const calls: VerifyRequest[] = [];
  return {
    calls,
    async verify(req) {
      calls.push(req);
      if (answers === 'yes') return JSON.stringify({ keeps_content: true, reason: 'only wobble removed' });
      if (answers === 'no') return JSON.stringify({ keeps_content: false, reason: 'the kiss happens in the shake' });
      const a = answers.shift();
      if (a === undefined) throw new Error('no answer queued');
      return typeof a === 'function' ? a(req) : a;
    },
  };
}

describe('fixShakes', () => {
  let t: T;
  let hl: HighlightRepository;
  let motion: MotionRepository;
  let clipId: number;
  const exists = () => true;

  const putShakes = (id: number, shakes: Shake[]) => motion.save(id, {
    curve: { fps: 25, width: 320, srcWidth: 1920, dx: new Int8Array(750), dy: new Int8Array(750), change: new Float32Array(750) },
    medianResidual: 0.1, continuous: false, shakes,
  });
  const row = (id: number) => t.db.prepare('SELECT * FROM highlights WHERE id = ?').get(id) as any;
  const run = (v: ShakeVerifier | null, over: Record<string, unknown> = {}) => fixShakes(t.db, { projectId: t.projectId, verifier: v, exists, ...over });

  beforeEach(() => {
    t = setup();
    hl = new HighlightRepository(t.db);
    motion = new MotionRepository(t.db);
    clipId = t.addClip({ fps: 25, duration: 30 }).id;
  });

  it('a moment without a shake is clean; no Gemini call', async () => {
    const [m] = t.addMoments(clipId, [{ start_sec: 2, end_sec: 12 }]);
    putShakes(clipId, [shake(20, 20.3)]);
    const v = fake('yes');
    const r = await run(v);
    expect(v.calls).toHaveLength(0);
    expect(r.moments[0]).toMatchObject({ moment_id: m, status: 'clean', plan: { kind: 'clean' } });
    expect(row(m)).toMatchObject({ shake_status: 'clean', shake_checked_start: 2, shake_checked_end: 12 });
  });

  it('yes -> trim applied as an AI edit (still unprotected), status fixed, the panel keeps pointing at the moment', async () => {
    const [m] = t.addMoments(clipId, [{ start_sec: 2, end_sec: 12 }]);
    putShakes(clipId, [shake(1.5, 3)]);
    const cutId = t.svc.createCut(t.projectId, 'Main').id;
    const sceneId = t.svc.addScene(cutId, 'S').id;
    const p = t.svc.addPanel(sceneId, { intent: 'x', momentId: m, source: 'ai' });
    const v = fake('yes');
    const r = await run(v);
    expect(v.calls).toHaveLength(1);
    expect(r.moments[0]).toMatchObject({ status: 'fixed', applied: true, new_moment_ids: [] });
    expect(r.totals).toMatchObject({ checked: 1, fixed: 1, gemini_calls: 1 });
    expect(row(m)).toMatchObject({ start_sec: 3.04, end_sec: 12, ai_start_sec: 3.04, ai_end_sec: 12, status: 'proposed', shake_status: 'fixed', shake_checked_start: 3.04 });
    expect(hl.protectionReasons(m)).toEqual([]);
    expect((t.db.prepare('SELECT moment_id FROM story_segments WHERE id = ?').get(p.id) as any).moment_id).toBe(m);
  });

  it('the AI check gets the excerpt of the range +- 0.5 s, the description, the shakes and the kept part', async () => {
    t.addMoments(clipId, [{ start_sec: 2, end_sec: 12, description: 'a kiss on the beach' }]);
    putShakes(clipId, [shake(1.5, 3)]);
    const v = fake('yes');
    await run(v);
    const req = v.calls[0]!;
    expect([req.source, req.from, req.to]).toEqual(['/v/c1.mp4', 1.5, 12.5]);
    expect(req.prompt.user).toContain('a kiss on the beach');
    expect(req.prompt.user).toContain('0.50-1.50 s'); // the shake (clipped to the range 2-3), relative to the excerpt start 1.5
    expect(req.prompt.user).toContain('1.54-10.50 s'); // the kept part 3.04-12
  });

  it('prefers the proxy as the excerpt source', async () => {
    t.addMoments(clipId, [{ start_sec: 2, end_sec: 12 }]);
    t.db.prepare("UPDATE clips SET proxy_path = '/p/c1.mp4' WHERE id = ?").run(clipId);
    putShakes(clipId, [shake(1.5, 3)]);
    const v = fake('yes');
    await run(v);
    expect(v.calls[0]!.source).toBe('/p/c1.mp4');
  });

  it('no -> range unchanged, status kept, note = the AI\'s reason', async () => {
    const [m] = t.addMoments(clipId, [{ start_sec: 2, end_sec: 12 }]);
    putShakes(clipId, [shake(1.5, 3)]);
    const r = await run(fake('no'));
    expect(r.moments[0]).toMatchObject({ status: 'kept', applied: false, reason: 'the kiss happens in the shake' });
    expect(row(m)).toMatchObject({ start_sec: 2, end_sec: 12, shake_status: 'kept', shake_note: 'the kiss happens in the shake' });
    expect(r.totals).toMatchObject({ kept: 1, fixed: 0 });
  });

  it('a malformed answer is retried (up to 3 calls), then used', async () => {
    const [m] = t.addMoments(clipId, [{ start_sec: 2, end_sec: 12 }]);
    putShakes(clipId, [shake(1.5, 3)]);
    const v = fake(['not json', '{"keeps_content": "maybe"}', '{"keeps_content": true, "reason": "ok"}']);
    const r = await run(v);
    expect(v.calls).toHaveLength(3);
    expect(r.moments[0]!.status).toBe('fixed');
    expect(row(m).start_sec).toBe(3.04);
  });

  it('three malformed answers = an error: nothing changed, not marked, the run goes on', async () => {
    const [a, b] = t.addMoments(clipId, [{ start_sec: 2, end_sec: 12 }, { start_sec: 16, end_sec: 26 }]);
    putShakes(clipId, [shake(1.5, 3), shake(15.5, 17)]);
    const v = fake(['x', 'y', 'z', JSON.stringify({ keeps_content: true, reason: 'ok' })]);
    const r = await run(v);
    expect(r.totals).toMatchObject({ errors: 1, fixed: 1 });
    expect(r.moments[0]!.error).toMatch(/invalid after 3 attempts/);
    expect(row(a)).toMatchObject({ start_sec: 2, shake_status: null });
    expect(row(b)).toMatchObject({ start_sec: 17.04, shake_status: 'fixed' });
  });

  it('without a verifier the trim / split plans are left alone, status stays null', async () => {
    const [m] = t.addMoments(clipId, [{ start_sec: 2, end_sec: 12 }]);
    putShakes(clipId, [shake(1.5, 3)]);
    const r = await run(null);
    expect(r.totals).toMatchObject({ unverified: 1, fixed: 0, gemini_calls: 0 });
    expect(row(m)).toMatchObject({ start_sec: 2, end_sec: 12, shake_status: null });
  });

  it('dry run: plans only, no Gemini call, nothing written (not even clean / kept)', async () => {
    const [a, b, c] = t.addMoments(clipId, [{ start_sec: 2, end_sec: 12 }, { start_sec: 14, end_sec: 15.5 }, { start_sec: 20, end_sec: 26 }]);
    putShakes(clipId, [shake(1.5, 3), shake(14.5, 14.7)]);
    const v = fake('yes');
    const before = t.db.prepare('SELECT * FROM highlights ORDER BY id').all();
    const r = await run(v, { dryRun: true });
    expect(v.calls).toHaveLength(0);
    expect(t.db.prepare('SELECT * FROM highlights ORDER BY id').all()).toEqual(before);
    const by = (id: number) => r.moments.find((x) => x.moment_id === id)!;
    expect(by(a).plan.kind).toBe('trim');
    expect(by(a).status).toBeNull();
    expect(by(b)).toMatchObject({ status: 'kept', plan: { kind: 'kept', reason: 'no_clean_range' } });
    expect(by(c)).toMatchObject({ status: 'clean' });
    expect(r.totals).toMatchObject({ unverified: 1, kept: 1, clean: 1, gemini_calls: 0 });
  });

  it('a split creates sibling moments (split_of, unprotected) and a panel behind every panel using the moment, in every cut', async () => {
    const [m] = t.addMoments(clipId, [{ start_sec: 2, end_sec: 12 }]);
    putShakes(clipId, [shake(6, 6.5), shake(9, 9.2)]);
    const cut1 = t.svc.createCut(t.projectId, 'Main').id;
    const cut2 = t.svc.createCut(t.projectId, 'Alt').id;
    const s1 = t.svc.addScene(cut1, 'S').id;
    const s2 = t.svc.addScene(cut2, 'S').id;
    const p1 = t.svc.addPanel(s1, { intent: 'one', momentId: m, source: 'ai' });
    const tail1 = t.svc.addPanel(s1, { intent: 'tail', source: 'ai' });
    const p2 = t.svc.addPanel(s2, { intent: 'two', momentId: m, source: 'ai' });
    const r = await run(fake('yes'));
    expect(r.moments[0]).toMatchObject({ status: 'fixed', applied: true });
    const sib = r.moments[0]!.new_moment_ids;
    expect(sib).toHaveLength(2);
    expect(row(m)).toMatchObject({ start_sec: 2, end_sec: 5.96, shake_status: 'fixed' });
    expect(row(sib[0]!)).toMatchObject({ start_sec: 6.54, end_sec: 8.96, split_of: m, status: 'proposed', shake_status: 'fixed', shake_checked_start: 6.54 });
    expect(row(sib[1]!)).toMatchObject({ start_sec: 9.24, end_sec: 12, split_of: m, ai_start_sec: 9.24 });
    for (const id of [m, ...sib]) expect(hl.protectionReasons(id)).toEqual([]);
    const order = (scene: number) => (t.db.prepare('SELECT id, moment_id, intent, source FROM story_segments WHERE scene_id = ? ORDER BY position').all(scene) as any[]);
    expect(order(s1).map((x) => x.moment_id)).toEqual([m, sib[0], sib[1], null]);
    expect(order(s1)[0].id).toBe(p1.id);
    expect(order(s1)[3].id).toBe(tail1.id);
    expect(order(s2).map((x) => [x.moment_id, x.intent, x.source])).toEqual([[m, 'two', 'ai'], [sib[0], 'two', 'ai'], [sib[1], 'two', 'ai']]);
    expect(order(s2)[0].id).toBe(p2.id);
    expect(r.totals.new_moments).toBe(2);
  });

  it('one undo step "Shake fix (n moments)" per cut that uses a changed moment; undo restores moments + panels, redo re-applies', async () => {
    const [a, b] = t.addMoments(clipId, [{ start_sec: 2, end_sec: 12 }, { start_sec: 16, end_sec: 26 }]);
    putShakes(clipId, [shake(6, 6.5), shake(15.5, 17)]);
    const cut1 = t.svc.createCut(t.projectId, 'Main').id;
    const cut2 = t.svc.createCut(t.projectId, 'Alt').id;
    const s1 = t.svc.addScene(cut1, 'S').id;
    const s2 = t.svc.addScene(cut2, 'S').id;
    t.svc.addPanel(s1, { intent: 'a', momentId: a, source: 'ai' });
    t.svc.addPanel(s1, { intent: 'b', momentId: b, source: 'ai' });
    t.svc.addPanel(s2, { intent: 'a', momentId: a, source: 'ai' });
    const before = {
      moments: t.db.prepare('SELECT id, start_sec, end_sec, ai_start_sec, ai_end_sec, status FROM highlights ORDER BY id').all(),
      panels: t.db.prepare('SELECT id, scene_id, position, moment_id FROM story_segments ORDER BY id').all(),
    };
    await run(fake('yes'));
    expect(t.svc.history(cut1).map((h) => h.label)).toEqual(['Shake fix (2 moments)']);
    expect(t.svc.history(cut2).map((h) => h.label)).toEqual(['Shake fix (1 moment)']);
    const after = {
      moments: t.db.prepare('SELECT id, start_sec, end_sec, ai_start_sec, ai_end_sec, status FROM highlights ORDER BY id').all(),
      panels: t.db.prepare('SELECT id, scene_id, position, moment_id FROM story_segments ORDER BY id').all(),
    };
    expect(after.moments).toHaveLength(3);
    t.svc.undo(cut1);
    // cut1's undo restores the moments of the project and cut1's panels; cut2's panels are not part of cut1's step
    expect(t.db.prepare('SELECT id, start_sec, end_sec FROM highlights ORDER BY id').all()).toEqual(
      (before.moments as any[]).map(({ id, start_sec, end_sec }) => ({ id, start_sec, end_sec })));
    expect(t.db.prepare('SELECT id FROM story_segments WHERE story_id = ? ORDER BY id').all(cut1)).toEqual(
      (before.panels as any[]).filter((p) => p.scene_id === s1).map((p) => ({ id: p.id })));
    t.svc.redo(cut1);
    expect(t.db.prepare('SELECT id, start_sec, end_sec, ai_start_sec, ai_end_sec, status FROM highlights ORDER BY id').all()).toEqual(after.moments);
    expect(t.db.prepare('SELECT id, scene_id, position, moment_id FROM story_segments WHERE story_id = ? ORDER BY id').all(cut1)).toEqual(
      (after.panels as any[]).filter((p) => p.scene_id === s1));
  });

  it('a moment used by no cut is changed without a history step', async () => {
    const [m] = t.addMoments(clipId, [{ start_sec: 2, end_sec: 12 }]);
    putShakes(clipId, [shake(1.5, 3)]);
    const cutId = t.svc.createCut(t.projectId, 'Main').id;
    await run(fake('yes'));
    expect(row(m).start_sec).toBe(3.04);
    expect(t.svc.history(cutId)).toEqual([]);
  });

  it('protected moments are never changed, but marked kept ("protected") when they contain a shake; clean otherwise', async () => {
    const [a, b, c, d] = t.addMoments(clipId, [
      { start_sec: 2, end_sec: 12 }, { start_sec: 2, end_sec: 12 }, { start_sec: 2, end_sec: 12 }, { start_sec: 20, end_sec: 25 }]);
    t.db.prepare("UPDATE highlights SET status = 'confirmed' WHERE id = ?").run(a);
    t.db.prepare('UPDATE highlights SET speed = 0.5 WHERE id = ?').run(b);
    t.db.prepare("UPDATE highlights SET user_tier = 'hero' WHERE id = ?").run(c);
    t.db.prepare("UPDATE highlights SET status = 'confirmed' WHERE id = ?").run(d);
    putShakes(clipId, [shake(1.5, 3)]);
    const v = fake('yes');
    const r = await run(v);
    expect(v.calls).toHaveLength(0);
    for (const id of [a, b, c]) expect(row(id)).toMatchObject({ start_sec: 2, end_sec: 12, shake_status: 'kept', shake_note: expect.stringMatching(/protected/i) });
    expect(row(d)).toMatchObject({ shake_status: 'clean' });
    expect(r.totals).toMatchObject({ kept: 3, clean: 1, fixed: 0 });
  });

  it('a moment already checked for its range is not looked at again (no second Gemini call); a changed range is', async () => {
    const [m] = t.addMoments(clipId, [{ start_sec: 2, end_sec: 12 }]);
    putShakes(clipId, [shake(1.5, 3)]);
    const v = fake('no');
    await run(v);
    expect(v.calls).toHaveLength(1);
    const again = await run(v);
    expect(v.calls).toHaveLength(1);
    expect(again.totals).toMatchObject({ skipped: 1, checked: 0 });
    // an AI trim moves the range: the old verdict does not apply any more
    t.svc.trimMoment(m, 2, 10, { ai: true });
    const third = await run(v);
    expect(v.calls).toHaveLength(2);
    expect(third.totals.checked).toBe(1);
  });

  it('fixed moments are stable: a second run changes nothing', async () => {
    t.addMoments(clipId, [{ start_sec: 2, end_sec: 12 }]);
    putShakes(clipId, [shake(6, 6.5)]);
    const v = fake('yes');
    await run(v);
    const rows = t.db.prepare('SELECT * FROM highlights ORDER BY id').all();
    const r2 = await run(v);
    expect(v.calls).toHaveLength(1);
    expect(r2.totals).toMatchObject({ checked: 0, skipped: 2 });
    expect(t.db.prepare('SELECT * FROM highlights ORDER BY id').all()).toEqual(rows);
  });

  it('a plan that would cut a sentence is kept ("sentence") without asking the AI', async () => {
    const [m] = t.addMoments(clipId, [{ start_sec: 2, end_sec: 12 }]);
    putShakes(clipId, [shake(6, 6.5)]);
    new TranscriptRepository(t.db).save(clipId, 'm', { language: 'en', text: 'x', segments: [{ start: 5.5, end: 8, text: 'Hello there.' }], words: [] });
    const v = fake('yes');
    const r = await run(v);
    expect(v.calls).toHaveLength(0);
    expect(r.moments[0]).toMatchObject({ status: 'kept' });
    expect(row(m)).toMatchObject({ shake_status: 'kept', shake_note: expect.stringMatching(/sentence/) });
  });

  it('low and high confidence shakes both count', async () => {
    t.addMoments(clipId, [{ start_sec: 2, end_sec: 12 }]);
    putShakes(clipId, [shake(6, 6.5, 'low')]);
    const r = await run(fake('yes'));
    expect(r.moments[0]).toMatchObject({ status: 'fixed' });
  });

  it('--cut: only the moments panels of that cut use; rejected moments and unmeasured clips are skipped', async () => {
    const [a, b, rej] = t.addMoments(clipId, [{ start_sec: 2, end_sec: 12 }, { start_sec: 16, end_sec: 26 }, { start_sec: 13, end_sec: 15 }]);
    t.db.prepare("UPDATE highlights SET status = 'rejected' WHERE id = ?").run(rej);
    const other = t.addClip({ fps: 25 }).id;
    t.addMoments(other, [{ start_sec: 2, end_sec: 12 }]);
    putShakes(clipId, [shake(1.5, 3), shake(15.5, 17), shake(13.2, 13.5)]);
    const cutId = t.svc.createCut(t.projectId, 'Main').id;
    const sceneId = t.svc.addScene(cutId, 'S').id;
    t.svc.addPanel(sceneId, { intent: 'a', momentId: a, source: 'ai' });
    const r = await run(fake('yes'), { cutId });
    expect(r.moments.map((x) => x.moment_id)).toEqual([a]);
    expect(row(b).shake_status).toBeNull();
    const all = await run(fake('yes'));
    expect(all.moments.map((x) => x.moment_id)).toEqual([b]);
    expect(all.totals.unmeasured).toBe(1);
    expect(row(rej).shake_status).toBeNull();
  });

  it('shows shake_status / shake_note on the storyboard moments, and null once the range changed', async () => {
    const [m] = t.addMoments(clipId, [{ start_sec: 2, end_sec: 12 }]);
    putShakes(clipId, [shake(1.5, 3)]);
    await run(fake('no'));
    const listed = () => t.svc.listMoments(t.projectId).find((x) => x.id === m)!;
    expect(listed()).toMatchObject({ shake_status: 'kept', shake_note: 'the kiss happens in the shake' });
    t.svc.trimMoment(m, 2, 10);
    expect(listed()).toMatchObject({ shake_status: null, shake_note: null });
  });
});
