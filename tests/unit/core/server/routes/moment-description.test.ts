import { describe, it, expect, beforeEach } from 'vitest';
import { setup } from '../../storyboard/_helpers.js';
import { createCutRoutes } from '../../../../../src/core/server/routes/cuts.js';

describe('PATCH /moments/:id description (BE5)', () => {
  let t: ReturnType<typeof setup>;
  let app: ReturnType<typeof createCutRoutes>;
  let m: number[];
  let cutId: number;
  const send = (method: string, url: string, body?: unknown) => app.request(url, {
    method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ok = async (method: string, url: string, body?: unknown) => {
    const res = await send(method, url, body);
    expect(res.status, `${method} ${url}`).toBe(200);
    return ((await res.json()) as any).data;
  };
  const desc = (id: number) => (t.db.prepare('SELECT description FROM highlights WHERE id = ?').get(id) as any).description;

  beforeEach(async () => {
    t = setup();
    app = createCutRoutes(t.db, {});
    const clipId = t.addClip({ fps: 60, duration: 30 }).id;
    m = t.addMoments(clipId, [{ start_sec: 2, end_sec: 6 }]);
    t.db.prepare("UPDATE highlights SET description = 'old' WHERE id = ?").run(m[0]);
    cutId = (await ok('POST', `/projects/${t.projectId}/cuts`, { name: 'Main' })).id;
  });

  it('saves the trimmed text as one undo step "Edit description" by the user', async () => {
    const r = await ok('PATCH', `/moments/${m[0]}`, { cut_id: cutId, description: '  sunset  ' });
    expect(r).toMatchObject({ id: m[0], description: 'sunset', status: 'confirmed' });
    expect(r.history).toMatchObject({ can_undo: true, undo_label: 'Edit description' });
    expect(t.db.prepare('SELECT label, actor FROM operations').all()).toEqual([{ label: 'Edit description', actor: 'user' }]);
    await ok('POST', `/cuts/${cutId}/undo`);
    expect(desc(m[0]!)).toBe('old');
    await ok('POST', `/cuts/${cutId}/redo`);
    expect(desc(m[0]!)).toBe('sunset');
  });

  it('can be combined with a trim in one step', async () => {
    const r = await ok('PATCH', `/moments/${m[0]}`, { cut_id: cutId, description: 'x', start_sec: 3, end_sec: 5 });
    expect(r).toMatchObject({ description: 'x', start_sec: 3 });
    expect(r.history.undo_label).toBe('Trim moment, Edit description');
  });

  it('validation: a string of at most 300 characters; nothing is logged on failure', async () => {
    for (const body of [{ cut_id: cutId, description: 5 }, { cut_id: cutId, description: 'x'.repeat(301) }]) {
      expect((await send('PATCH', `/moments/${m[0]}`, body)).status).toBe(400);
    }
    expect(desc(m[0]!)).toBe('old');
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM operations').get()).toEqual({ n: 0 });
  });
});
