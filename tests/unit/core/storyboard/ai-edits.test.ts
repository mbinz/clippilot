import { describe, it, expect, beforeEach } from 'vitest';
import { setup } from './_helpers.js';
import { HighlightRepository } from '../../../../src/db/repositories/highlight.repository.js';

type T = ReturnType<typeof setup>;

describe('AI edits (--ai): trim / speed / place keep the moment unprotected', () => {
  let t: T;
  let hl: HighlightRepository;
  let cutId: number;
  let sceneId: number;
  let clipId: number;
  let m: number[];
  beforeEach(() => {
    t = setup();
    hl = new HighlightRepository(t.db);
    cutId = t.svc.createCut(t.projectId, 'Main').id;
    sceneId = t.svc.addScene(cutId, 'S').id;
    clipId = t.addClip({ fps: 60, duration: 60 }).id;
    m = t.addMoments(clipId, [{ start_sec: 2, end_sec: 12 }, { start_sec: 20, end_sec: 30 }]);
  });
  const row = (id: number) => t.db.prepare('SELECT * FROM highlights WHERE id = ?').get(id) as any;

  describe('trim', () => {
    it('without ai it is the user\'s decision: confirmed, protected (as today)', () => {
      t.svc.trimMoment(m[0]!, 3, 8);
      expect(row(m[0]!).status).toBe('confirmed');
      expect(hl.protectionReasons(m[0]!)).toContain('trimmed');
    });

    it('with ai the range moves, the moment stays proposed and unprotected (ai range moves along)', () => {
      t.svc.trimMoment(m[0]!, 3, 8, { ai: true });
      const r = row(m[0]!);
      expect([r.start_sec, r.end_sec, r.ai_start_sec, r.ai_end_sec, r.status]).toEqual([3, 8, 3, 8, 'proposed']);
      expect(hl.protectionReasons(m[0]!)).toEqual([]);
      expect(hl.findUnprotected(clipId).map((x) => x.id)).toContain(m[0]);
    });

    it('with ai it leaves the panel source alone', () => {
      const p = t.svc.addPanel(sceneId, { intent: 'x', momentId: m[0]!, source: 'ai' });
      t.svc.trimMoment(m[0]!, 3, 8, { ai: true });
      expect((t.db.prepare('SELECT source FROM story_segments WHERE id = ?').get(p.id) as any).source).toBe('ai');
      expect(hl.protectionReasons(m[0]!)).toEqual([]);
    });

    it('with ai a protected moment is refused (tools never change user-touched moments)', () => {
      t.svc.trimMoment(m[0]!, 3, 8);
      expect(() => t.svc.trimMoment(m[0]!, 4, 8, { ai: true })).toThrow(/protected.*confirmed/);
      expect(row(m[0]!).start_sec).toBe(3);
    });

    it('undo restores the range and the ai range; a later user trim protects it', () => {
      t.svc.command(cutId, 'ai trim', () => t.svc.trimMoment(m[0]!, 3, 8, { ai: true }));
      t.svc.undo(cutId);
      const r = row(m[0]!);
      expect([r.start_sec, r.end_sec, r.ai_start_sec, r.ai_end_sec]).toEqual([2, 12, 2, 12]);
      expect(hl.protectionReasons(m[0]!)).toEqual([]);
      t.svc.redo(cutId);
      expect([row(m[0]!).start_sec, row(m[0]!).ai_start_sec]).toEqual([3, 3]);
      t.svc.trimMoment(m[0]!, 4, 8);
      expect(hl.protectionReasons(m[0]!)).toEqual(['confirmed', 'trimmed']);
    });
  });

  describe('speed', () => {
    it('with ai the speed changes without counting as "speed changed"', () => {
      t.svc.setMomentSpeed(m[0]!, 0.5, { ai: true });
      const r = row(m[0]!);
      expect([r.speed, r.ai_speed, r.status]).toEqual([0.5, 0.5, 'proposed']);
      expect(hl.protectionReasons(m[0]!)).toEqual([]);
      expect(hl.findUnprotected(clipId).map((x) => x.id)).toContain(m[0]);
    });

    it('a later user speed edit (no ai) protects it as today', () => {
      t.svc.setMomentSpeed(m[0]!, 0.5, { ai: true });
      t.svc.setMomentSpeed(m[0]!, 1);
      expect(hl.protectionReasons(m[0]!)).toEqual(['confirmed', 'speed']);
      expect(hl.findUnprotected(clipId).map((x) => x.id)).not.toContain(m[0]);
    });

    it('with ai a protected moment is refused', () => {
      t.svc.setMomentSpeed(m[0]!, 0.5);
      expect(() => t.svc.setMomentSpeed(m[0]!, 1, { ai: true })).toThrow(/protected/);
    });

    it('undo restores speed and ai_speed; reset clears ai_speed', () => {
      t.svc.command(cutId, 'ai speed', () => t.svc.setMomentSpeed(m[0]!, 0.5, { ai: true }));
      t.svc.undo(cutId);
      expect([row(m[0]!).speed, row(m[0]!).ai_speed]).toEqual([1, null]);
      t.svc.redo(cutId);
      expect([row(m[0]!).speed, row(m[0]!).ai_speed]).toEqual([0.5, 0.5]);
      t.svc.resetMoment(m[0]!);
      expect([row(m[0]!).speed, row(m[0]!).ai_speed]).toEqual([1, null]);
    });

    it('speed gating still applies', () => {
      const slow = t.addMoments(t.addClip({ fps: 25 }).id, [{}]);
      expect(() => t.svc.setMomentSpeed(slow[0]!, 0.5, { ai: true })).toThrow(/frame rate/);
    });
  });

  describe('place', () => {
    it('without ai it is the user\'s decision (as today)', () => {
      const p = t.svc.addPanel(sceneId, { intent: 'x' });
      t.svc.placeMoment(p.id, m[0]!);
      expect(row(m[0]!).status).toBe('confirmed');
      expect((t.db.prepare('SELECT source FROM story_segments WHERE id = ?').get(p.id) as any).source).toBe('user');
    });

    it('with ai the panel gets the moment as an AI panel and the moment stays unprotected', () => {
      const p = t.svc.addPanel(sceneId, { intent: 'x', momentId: m[1]!, source: 'ai' });
      t.svc.placeMoment(p.id, m[0]!, { ai: true });
      const pr = t.db.prepare('SELECT source, moment_id, state FROM story_segments WHERE id = ?').get(p.id) as any;
      expect(pr).toEqual({ source: 'ai', moment_id: m[0], state: 'filled' });
      expect(row(m[0]!).status).toBe('proposed');
      expect(hl.protectionReasons(m[0]!)).toEqual([]);
    });

    it('with ai a user-placed panel is not overwritten', () => {
      const p = t.svc.addPanel(sceneId, { intent: 'x' });
      t.svc.placeMoment(p.id, m[1]!);
      expect(() => t.svc.placeMoment(p.id, m[0]!, { ai: true })).toThrow(/user/);
      expect((t.db.prepare('SELECT moment_id FROM story_segments WHERE id = ?').get(p.id) as any).moment_id).toBe(m[1]);
    });

    it('undo restores the previous panel state', () => {
      const p = t.svc.addPanel(sceneId, { intent: 'x', momentId: m[1]!, source: 'ai' });
      t.svc.command(cutId, 'ai place', () => t.svc.placeMoment(p.id, m[0]!, { ai: true }));
      t.svc.undo(cutId);
      expect(t.db.prepare('SELECT source, moment_id FROM story_segments WHERE id = ?').get(p.id)).toEqual({ source: 'ai', moment_id: m[1] });
      expect(row(m[0]!).status).toBe('proposed');
    });
  });

  describe('cut out', () => {
    it('trims the moment before the cut and creates an unprotected sibling after it, with its own panel behind', () => {
      const p = t.svc.addPanel(sceneId, { intent: 'wave', momentId: m[0]!, source: 'ai' });
      const after = t.svc.addPanel(sceneId, { intent: 'next', source: 'ai' });
      const res = t.svc.cutOutMoment(m[0]!, 5, 7, { ai: true, cutId });
      const parent = row(m[0]!);
      expect([parent.start_sec, parent.end_sec, parent.status]).toEqual([2, 5, 'proposed']);
      const sib = row(res.sibling_id);
      expect([sib.clip_id, sib.start_sec, sib.end_sec, sib.split_of, sib.status, sib.description, sib.tier])
        .toEqual([clipId, 7, 12, m[0], 'proposed', 'm', 'solid']);
      expect([sib.ai_start_sec, sib.ai_end_sec]).toEqual([7, 12]);
      expect(hl.protectionReasons(m[0]!)).toEqual([]);
      expect(hl.protectionReasons(res.sibling_id)).toEqual([]);
      const panels = t.db.prepare('SELECT id, moment_id, intent, source, position FROM story_segments ORDER BY position').all() as any[];
      expect(panels.map((x) => x.id)).toEqual([p.id, res.panels[0], after.id]);
      expect(panels[1]).toMatchObject({ moment_id: res.sibling_id, intent: 'wave', source: 'ai' });
    });

    it('without ai the parent is the user\'s decision (confirmed, panels theirs); the sibling is still an AI moment', () => {
      const p = t.svc.addPanel(sceneId, { intent: 'wave', momentId: m[0]!, source: 'ai' });
      const res = t.svc.cutOutMoment(m[0]!, 5, 7, { cutId });
      expect(row(m[0]!).status).toBe('confirmed');
      expect(hl.protectionReasons(m[0]!)).toContain('trimmed');
      expect(hl.protectionReasons(res.sibling_id)).toEqual([]);
      expect((t.db.prepare('SELECT source FROM story_segments WHERE id = ?').get(p.id) as any).source).toBe('user');
      expect((t.db.prepare('SELECT source FROM story_segments WHERE id = ?').get(res.panels[0]) as any).source).toBe('user');
    });

    it('the sibling inherits the speed as an AI speed', () => {
      t.svc.setMomentSpeed(m[0]!, 0.5, { ai: true });
      const res = t.svc.cutOutMoment(m[0]!, 5, 7, { ai: true, cutId });
      expect(hl.protectionReasons(res.sibling_id)).toEqual([]);
      expect(row(res.sibling_id).speed).toBe(0.5);
    });

    it('validates: inside the moment, both parts >= 1 s, from < to', () => {
      expect(() => t.svc.cutOutMoment(m[0]!, 1, 5, { ai: true, cutId })).toThrow(/inside/);
      expect(() => t.svc.cutOutMoment(m[0]!, 5, 13, { ai: true, cutId })).toThrow(/inside/);
      expect(() => t.svc.cutOutMoment(m[0]!, 2.5, 5, { ai: true, cutId })).toThrow(/at least 1/);
      expect(() => t.svc.cutOutMoment(m[0]!, 5, 11.5, { ai: true, cutId })).toThrow(/at least 1/);
      expect(() => t.svc.cutOutMoment(m[0]!, 6, 5, { ai: true, cutId })).toThrow(/before/);
      expect(row(m[0]!).end_sec).toBe(12);
      expect(t.db.prepare('SELECT COUNT(*) AS n FROM highlights').get()).toEqual({ n: 2 });
    });

    it('with ai a protected moment is refused', () => {
      t.svc.trimMoment(m[0]!, 2, 12.5 - 0.5);
      t.svc.starMoment(m[0]!, true);
      expect(() => t.svc.cutOutMoment(m[0]!, 5, 7, { ai: true, cutId })).toThrow(/protected/);
    });

    it('is one undo step: undo removes the sibling and its panel and restores the parent; redo brings them back', () => {
      const p = t.svc.addPanel(sceneId, { intent: 'wave', momentId: m[0]!, source: 'ai' });
      const res = t.svc.command(cutId, 'cut out', () => t.svc.cutOutMoment(m[0]!, 5, 7, { ai: true, cutId }));
      t.svc.undo(cutId);
      expect(t.db.prepare('SELECT COUNT(*) AS n FROM highlights').get()).toEqual({ n: 2 });
      expect(t.db.prepare('SELECT id FROM story_segments').all()).toEqual([{ id: p.id }]);
      const r = row(m[0]!);
      expect([r.start_sec, r.end_sec, r.ai_start_sec, r.ai_end_sec, r.status]).toEqual([2, 12, 2, 12, 'proposed']);
      t.svc.redo(cutId);
      expect(row(res.sibling_id)).toMatchObject({ start_sec: 7, end_sec: 12, split_of: m[0] });
      expect(row(m[0]!).end_sec).toBe(5);
      expect(t.db.prepare('SELECT COUNT(*) AS n FROM story_segments').get()).toEqual({ n: 2 });
    });

    it('undo of a non-ai cut out also restores the parent as proposed', () => {
      t.svc.addPanel(sceneId, { intent: 'wave', momentId: m[0]!, source: 'ai' });
      t.svc.command(cutId, 'cut out', () => t.svc.cutOutMoment(m[0]!, 5, 7, { cutId }));
      t.svc.undo(cutId);
      expect(row(m[0]!)).toMatchObject({ status: 'proposed', start_sec: 2, end_sec: 12 });
      expect(hl.protectionReasons(m[0]!)).toEqual([]);
    });
  });
});
