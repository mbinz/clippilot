import { describe, it, expect } from 'vitest';
import { setup } from '../storyboard/_helpers.js';
import { HighlightRepository } from '../../../../src/db/repositories/highlight.repository.js';

describe('protection reasons of a moment', () => {
  it('is empty for an untouched proposal', () => {
    const { db, addClip, addMoments } = setup();
    const [m] = addMoments(addClip().id, [{}]);
    expect(new HighlightRepository(db).protectionReasons(m!)).toEqual([]);
  });

  it('names every kind of user decision, using the same definition as findUnprotected', () => {
    const { db, addClip, addMoments } = setup();
    const hl = new HighlightRepository(db);
    const [a, b, c, d, e] = addMoments(addClip().id, [{}, {}, {}, {}, {}]);
    db.prepare("UPDATE highlights SET status = 'confirmed' WHERE id = ?").run(a);
    db.prepare("UPDATE highlights SET status = 'rejected' WHERE id = ?").run(b);
    db.prepare('UPDATE highlights SET start_sec = start_sec + 1 WHERE id = ?').run(c);
    db.prepare('UPDATE highlights SET speed = 0.5 WHERE id = ?').run(d);
    db.prepare("UPDATE highlights SET user_tier = 'hero' WHERE id = ?").run(e);
    expect(hl.protectionReasons(a!)).toEqual(['confirmed']);
    expect(hl.protectionReasons(b!)).toEqual(['rejected']);
    expect(hl.protectionReasons(c!)).toEqual(['trimmed']);
    expect(hl.protectionReasons(d!)).toEqual(['speed']);
    expect(hl.protectionReasons(e!)).toEqual(['starred']);
  });

  it('does not count "used by a panel" (every critiqued moment is)', () => {
    const { db, svc, projectId, addClip, addMoments } = setup();
    const [m] = addMoments(addClip().id, [{}]);
    const cut = svc.createCut(projectId, 'c');
    const s = svc.addScene(cut.id, 's');
    svc.addPanel(s.id, { intent: 'x', momentId: m!, source: 'ai' });
    expect(new HighlightRepository(db).protectionReasons(m!)).toEqual([]);
  });
});
