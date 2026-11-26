import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setup } from '../../storyboard/_helpers.js';
import { createCutRoutes } from '../../../../../src/core/server/routes/cuts.js';
import type { LookEmbedder } from '../../../../../src/core/look/index.js';

describe('POST /clips/:id/moments (BE4)', () => {
  let t: ReturnType<typeof setup>;
  let app: ReturnType<typeof createCutRoutes>;
  let clipId: number;
  let cutId: number;
  let embedded: number;
  let release: (() => void) | null;
  let gate: Promise<void> | null;

  const send = (method: string, url: string, body?: unknown) => app.request(url, {
    method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ok = async (method: string, url: string, body?: unknown) => {
    const res = await send(method, url, body);
    expect(res.status, `${method} ${url}`).toBe(200);
    return ((await res.json()) as any).data;
  };
  const row = (id: number) => t.db.prepare('SELECT * FROM highlights WHERE id = ?').get(id) as any;

  beforeEach(async () => {
    t = setup();
    embedded = 0;
    release = null;
    gate = null;
    const embedder: LookEmbedder = {
      model: 'fake',
      embed: async (imgs) => { if (gate) await gate; embedded++; return imgs.map(() => new Float32Array([1, 0])); },
    };
    app = createCutRoutes(t.db, { look: { embedder, grab: async () => Buffer.from('x') } });
    clipId = t.addClip({ fps: 60, duration: 30 }).id;
    t.addMoments(clipId, [{ start_sec: 2, end_sec: 6 }]);
    cutId = (await ok('POST', `/projects/${t.projectId}/cuts`, { name: 'Main' })).id;
  });

  it('creates a confirmed solid moment, logged as one undo step "New moment" by the user', async () => {
    const m = await ok('POST', `/clips/${clipId}/moments`, { cut_id: cutId, start_sec: 10, end_sec: 14, description: 'waves' });
    expect(m).toMatchObject({ clip_id: clipId, start_sec: 10, end_sec: 14, status: 'confirmed', speed: 1 });
    expect(m.history).toMatchObject({ can_undo: true, undo_label: 'New moment' });
    expect(row(m.id)).toMatchObject({ description: 'waves', tier: 'solid', created_by: 'user' });
    expect(t.db.prepare('SELECT label, actor FROM operations').all()).toEqual([{ label: 'New moment', actor: 'user' }]);
  });

  it('undo deletes it, redo restores it', async () => {
    const m = await ok('POST', `/clips/${clipId}/moments`, { cut_id: cutId, start_sec: 10, end_sec: 14 });
    await ok('POST', `/cuts/${cutId}/undo`);
    expect(row(m.id)).toBeUndefined();
    await ok('POST', `/cuts/${cutId}/redo`);
    expect(row(m.id).start_sec).toBe(10);
  });

  it('answers before the fingerprint is computed, then fills it in the background (only then it counts as fresh)', async () => {
    gate = new Promise<void>((r) => { release = r; });
    const m = await ok('POST', `/clips/${clipId}/moments`, { cut_id: cutId, start_sec: 10, end_sec: 14 });
    expect(row(m.id).look_vec).toBeNull();
    release!();
    await vi.waitFor(() => expect(row(m.id).look_vec).not.toBeNull());
    expect(row(m.id)).toMatchObject({ look_model: 'fake', look_start_sec: 10, look_end_sec: 14 });
  });

  it('a failing embedder does not fail the request; the moment stays without fingerprint', async () => {
    const bad = createCutRoutes(t.db, { look: { embedder: { model: 'fake', embed: async () => { throw new Error('boom'); } }, grab: async () => Buffer.from('x') } });
    const res = await bad.request(`/clips/${clipId}/moments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cut_id: cutId, start_sec: 10, end_sec: 14 }) });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 30));
    expect(row(((await res.json()) as any).data.id).look_vec).toBeNull();
  });

  it('a failing embedder factory does not fail the request', async () => {
    const bad = createCutRoutes(t.db, { look: async () => { throw new Error('no model'); } });
    const res = await bad.request(`/clips/${clipId}/moments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cut_id: cutId, start_sec: 10, end_sec: 14 }) });
    expect(res.status).toBe(200);
  });

  it('validation: needs cut_id, numbers, a range, a known clip; nothing is created or logged', async () => {
    for (const [url, body] of [
      [`/clips/${clipId}/moments`, { start_sec: 10, end_sec: 14 }],
      [`/clips/${clipId}/moments`, { cut_id: cutId, start_sec: 'a', end_sec: 14 }],
      [`/clips/${clipId}/moments`, { cut_id: cutId, start_sec: 14, end_sec: 10 }],
      [`/clips/${clipId}/moments`, { cut_id: cutId, start_sec: 10, end_sec: 14, description: 5 }],
      [`/clips/9999/moments`, { cut_id: cutId, start_sec: 10, end_sec: 14 }],
    ] as const) {
      expect((await send('POST', url, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM highlights').get()).toEqual({ n: 1 });
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM operations').get()).toEqual({ n: 0 });
  });
});
