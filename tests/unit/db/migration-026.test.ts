import { describe, it, expect } from 'vitest';
import { setup } from '../core/storyboard/_helpers.js';
import { migration026 } from '../../../src/db/migrations/026_ai_speed_backfill.js';
import { HighlightRepository } from '../../../src/db/repositories/highlight.repository.js';

describe('migration 026 - backfill ai_speed for AI draft speeds', () => {
  it('marks only proposed moments whose speed differs from the default as AI speed', () => {
    const { db, addClip, addMoments } = setup();
    const clip = addClip({ fps: 25 });
    const [changed, confirmed, rejected, unchanged, withAi] = addMoments(clip, [
      { suggested_speed: 0.5 }, { suggested_speed: 0.5 }, { suggested_speed: 0.5 }, { suggested_speed: 0.5 }, { suggested_speed: 0.5 },
    ]);
    db.prepare('UPDATE highlights SET speed = 1 WHERE id IN (?, ?, ?, ?)').run(changed, confirmed, rejected, withAi);
    db.prepare("UPDATE highlights SET status = 'confirmed' WHERE id = ?").run(confirmed);
    db.prepare("UPDATE highlights SET status = 'rejected' WHERE id = ?").run(rejected);
    db.prepare('UPDATE highlights SET ai_speed = 2 WHERE id = ?').run(withAi);
    const hl = new HighlightRepository(db);
    expect(hl.protectionReasons(changed)).toContain('speed');

    migration026(db);

    const ai = (id: number) => (db.prepare('SELECT ai_speed FROM highlights WHERE id = ?').get(id) as any).ai_speed;
    expect(ai(changed)).toBe(1);
    expect(ai(confirmed)).toBeNull();
    expect(ai(rejected)).toBeNull();
    expect(ai(unchanged)).toBeNull();
    expect(ai(withAi)).toBe(2);
    expect(hl.protectionReasons(changed)).toEqual([]);
    expect(hl.protectionReasons(confirmed)).toContain('speed');
  });
});
