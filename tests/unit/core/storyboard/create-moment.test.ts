import { describe, it, expect, beforeEach } from 'vitest';
import { setup } from './_helpers.js';
import { HighlightRepository } from '../../../../src/db/repositories/highlight.repository.js';

describe('createMoment (BE4)', () => {
  let t: ReturnType<typeof setup>;
  let hl: HighlightRepository;
  let cutId: number;
  let clipId: number;
  const row = (id: number) => t.db.prepare('SELECT * FROM highlights WHERE id = ?').get(id) as any;
  beforeEach(() => {
    t = setup();
    hl = new HighlightRepository(t.db);
    cutId = t.svc.createCut(t.projectId, 'Main').id;
    clipId = t.addClip({ fps: 60, duration: 30 }).id;
    t.addMoments(clipId, [{ start_sec: 2, end_sec: 6 }]);
  });

  it('a user moment is confirmed, solid, speed 1, empty description, protected, no fingerprint', () => {
    const id = t.svc.createMoment(clipId, 10, 14);
    const r = row(id);
    expect([r.clip_id, r.start_sec, r.end_sec, r.status, r.tier, r.speed, r.description, r.user_tier]).toEqual([clipId, 10, 14, 'confirmed', 'solid', 1, '', null]);
    expect([r.ai_start_sec, r.ai_end_sec, r.look_vec]).toEqual([10, 14, null]);
    expect(hl.protectionReasons(id)).toEqual(['confirmed']);
  });

  it('takes a description', () => {
    expect(row(t.svc.createMoment(clipId, 10, 14, { description: 'waves' })).description).toBe('waves');
  });

  it('clamps to the clip length', () => {
    const r = row(t.svc.createMoment(clipId, 28, 45));
    expect([r.start_sec, r.end_sec]).toEqual([28, 30]);
    expect(row(t.svc.createMoment(clipId, -3, 1)).start_sec).toBe(0);
  });

  it('rejects end <= start, a too short range and unknown or hidden clips', () => {
    expect(() => t.svc.createMoment(clipId, 10, 10)).toThrow(/at least/);
    expect(() => t.svc.createMoment(clipId, 12, 10)).toThrow(/at least/);
    expect(() => t.svc.createMoment(clipId, 29.9, 40)).toThrow(/at least/);
    expect(() => t.svc.createMoment(9999, 1, 3)).toThrow(/not found/);
    t.svc.hideClip(clipId);
    expect(() => t.svc.createMoment(clipId, 10, 14)).toThrow(/hidden/);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM highlights').get()).toEqual({ n: 1 });
  });

  it('an ai moment is proposed and unprotected', () => {
    const id = t.svc.createMoment(clipId, 10, 14, { ai: true });
    expect(row(id).status).toBe('proposed');
    expect(hl.protectionReasons(id)).toEqual([]);
  });

  it('undo removes the moment, redo restores it (same id)', () => {
    const id = t.svc.command(cutId, 'New moment', () => t.svc.createMoment(clipId, 10, 14, { description: 'x' }));
    expect(row(id)).toBeTruthy();
    t.svc.undo(cutId);
    expect(row(id)).toBeUndefined();
    t.svc.redo(cutId);
    const r = row(id);
    expect([r.start_sec, r.end_sec, r.status, r.description]).toEqual([10, 14, 'confirmed', 'x']);
  });

  it('undoing in order: place the new moment, then undo twice removes the panel and the moment', () => {
    const scene = t.svc.addScene(cutId, 'S').id;
    const id = t.svc.command(cutId, 'New moment', () => t.svc.createMoment(clipId, 10, 14));
    const p = t.svc.command(cutId, 'Add panel', () => t.svc.addPanel(scene, { intent: 'x', momentId: id, source: 'user' }));
    t.svc.undo(cutId);
    expect(t.db.prepare('SELECT 1 FROM story_segments WHERE id = ?').get(p.id)).toBeUndefined();
    expect(row(id)).toBeTruthy();
    t.svc.undo(cutId);
    expect(row(id)).toBeUndefined();
    t.svc.redo(cutId);
    t.svc.redo(cutId);
    expect(t.db.prepare('SELECT moment_id FROM story_segments WHERE id = ?').get(p.id)).toEqual({ moment_id: id });
  });
});
