import { describe, it, expect, beforeEach } from 'vitest';
import { setup } from './_helpers.js';
import { HighlightRepository } from '../../../../src/db/repositories/highlight.repository.js';

describe('setMomentDescription (BE5)', () => {
  let t: ReturnType<typeof setup>;
  let cutId: number;
  let clipId: number;
  let m: number[];
  const row = (id: number) => t.db.prepare('SELECT description, status FROM highlights WHERE id = ?').get(id) as any;
  beforeEach(() => {
    t = setup();
    cutId = t.svc.createCut(t.projectId, 'Main').id;
    clipId = t.addClip({ fps: 60, duration: 30 }).id;
    m = t.addMoments(clipId, [{ start_sec: 2, end_sec: 6 }, { start_sec: 10, end_sec: 14 }]);
    t.db.prepare("UPDATE highlights SET description = 'original' WHERE id = ?").run(m[0]);
  });

  it('trims the text, stores it, and counts as the user\'s edit (confirmed)', () => {
    t.svc.setMomentDescription(m[0]!, '  surfers at dawn  ');
    expect(row(m[0]!)).toEqual({ description: 'surfers at dawn', status: 'confirmed' });
  });

  it('allows empty, rejects more than 300 characters and unknown moments', () => {
    t.svc.setMomentDescription(m[0]!, '   ');
    expect(row(m[0]!).description).toBe('');
    expect(() => t.svc.setMomentDescription(m[0]!, 'x'.repeat(301))).toThrow(/300/);
    expect(() => t.svc.setMomentDescription(m[0]!, 'x'.repeat(300))).not.toThrow();
    expect(() => t.svc.setMomentDescription(9999, 'a')).toThrow(/not found/);
    expect(() => t.svc.setMomentDescription(m[0]!, 5 as unknown as string)).toThrow(/string/);
  });

  it('with ai the moment stays unprotected; a protected moment is refused', () => {
    t.svc.setMomentDescription(m[1]!, 'by claude', { ai: true });
    expect(row(m[1]!)).toEqual({ description: 'by claude', status: 'proposed' });
    expect(new HighlightRepository(t.db).protectionReasons(m[1]!)).toEqual([]);
    t.svc.setMomentDescription(m[0]!, 'mine');
    expect(() => t.svc.setMomentDescription(m[0]!, 'claude again', { ai: true })).toThrow(/protected/);
  });

  it('undo restores the original text, redo the edit (also after a second edit)', () => {
    t.svc.command(cutId, 'Edit description', () => t.svc.setMomentDescription(m[0]!, 'first'));
    t.svc.command(cutId, 'Edit description', () => t.svc.setMomentDescription(m[0]!, 'second'));
    t.svc.undo(cutId);
    expect(row(m[0]!).description).toBe('first');
    t.svc.undo(cutId);
    expect(row(m[0]!)).toEqual({ description: 'original', status: 'proposed' });
    t.svc.redo(cutId);
    t.svc.redo(cutId);
    expect(row(m[0]!).description).toBe('second');
  });

  it('undo of a description on a moment made by hand keeps the description it was created with', () => {
    const id = t.svc.command(cutId, 'New moment', () => t.svc.createMoment(clipId, 20, 24, { description: 'made' }));
    t.svc.command(cutId, 'Edit description', () => t.svc.setMomentDescription(id, 'edited'));
    t.svc.undo(cutId);
    expect(row(id).description).toBe('made');
    t.svc.redo(cutId);
    expect(row(id).description).toBe('edited');
  });
});
