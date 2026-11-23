import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setup } from '../../storyboard/_helpers.js';
import { createCutRoutes } from '../../../../../src/core/server/routes/cuts.js';

describe('Board moment routes: seen, reveal, moment rows', () => {
  let t: ReturnType<typeof setup>;
  let app: ReturnType<typeof createCutRoutes>;
  let calls: string[][];
  let clipA: number;
  let ma: number[];

  const json = async (res: Response) => (await res.json()) as any;
  const send = (method: string, url: string, body?: unknown) =>
    app.request(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const ok = async (method: string, url: string, body?: unknown) => {
    const res = await send(method, url, body);
    expect(res.status, `${method} ${url}`).toBe(200);
    return (await json(res)).data;
  };
  const seenAt = (id: number) => (t.db.prepare('SELECT seen_at FROM highlights WHERE id = ?').get(id) as { seen_at: string | null }).seen_at;

  beforeEach(() => {
    t = setup();
    calls = [];
    app = createCutRoutes(t.db, { opener: async (args) => { calls.push(args); } });
    clipA = t.addClip({ fps: 60 }).id;
    ma = t.addMoments(clipA, [{ start_sec: 2, end_sec: 6 }, { start_sec: 10, end_sec: 14, tier: 'solid' }]);
  });

  describe('POST /moments/:id/seen', () => {
    it('sets and clears seen_at without touching the undo history', async () => {
      const cut = await ok('POST', `/projects/${t.projectId}/cuts`, { name: 'Main' });
      const before = await ok('GET', `/cuts/${cut.id}/history`);
      await ok('POST', `/moments/${ma[0]}/seen`, { seen: true });
      expect(seenAt(ma[0])).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect((await ok('GET', `/projects/${t.projectId}/moments`))[0].seen).toBe(true);
      await ok('POST', `/moments/${ma[0]}/seen`, { seen: false });
      expect(seenAt(ma[0])).toBeNull();
      expect((await ok('GET', `/projects/${t.projectId}/moments`))[0].seen).toBe(false);
      expect(await ok('GET', `/cuts/${cut.id}/history`)).toEqual(before);
      expect(t.db.prepare('SELECT COUNT(*) AS n FROM operations').get()).toEqual({ n: 0 });
    });

    it('is not part of undo snapshots: undoing an edit keeps seen', async () => {
      const cut = await ok('POST', `/projects/${t.projectId}/cuts`, { name: 'Main' });
      await ok('PATCH', `/moments/${ma[0]}`, { cut_id: cut.id, start_sec: 3, end_sec: 5 });
      await ok('POST', `/moments/${ma[0]}/seen`, { seen: true });
      await ok('POST', `/cuts/${cut.id}/undo`);
      expect(seenAt(ma[0])).not.toBeNull();
    });

    it('404 unknown moment, 400 bad body', async () => {
      expect((await send('POST', '/moments/9999/seen', { seen: true })).status).toBe(404);
      expect((await send('POST', `/moments/${ma[0]}/seen`, {})).status).toBe(400);
      expect((await send('POST', `/moments/${ma[0]}/seen`, { seen: 'yes' })).status).toBe(400);
    });
  });

  describe('POST /clips/:id/reveal', () => {
    it('opens the file in Finder via open -R', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-reveal-'));
      const file = path.join(dir, 'a.mp4');
      fs.writeFileSync(file, 'x');
      t.db.prepare('UPDATE clips SET file_path = ? WHERE id = ?').run(file, clipA);
      expect(await ok('POST', `/clips/${clipA}/reveal`)).toEqual({ ok: true, path: file });
      expect(calls).toEqual([['-R', file]]);
    });

    it('404 unknown clip, 409 when the file is gone', async () => {
      expect((await send('POST', '/clips/9999/reveal')).status).toBe(404);
      const res = await send('POST', `/clips/${clipA}/reveal`);
      expect(res.status).toBe(409);
      expect((await json(res)).error).toMatch(/not found|missing|exist/i);
      expect(calls).toEqual([]);
    });
  });

  describe('GET /projects/:id/moments rows', () => {
    it('carry speed, ai range, user_tier, effective tier, ai_tier, seen and clip recorded_at/event_id', async () => {
      const ev = Number(t.db.prepare("INSERT INTO events (project_id, name, source, sort_order) VALUES (?, 'E', 'folder', 0)").run(t.projectId).lastInsertRowid);
      t.db.prepare("UPDATE clips SET event_id = ?, recorded_at = '2026-05-01T10:00:00' WHERE id = ?").run(ev, clipA);
      const cut = await ok('POST', `/projects/${t.projectId}/cuts`, { name: 'Main' });
      await ok('PATCH', `/moments/${ma[1]}`, { cut_id: cut.id, start_sec: 11, end_sec: 13, speed: 0.5, tier: 'hero' });
      const rows = await ok('GET', `/projects/${t.projectId}/moments`);
      expect(rows[0]).toMatchObject({
        id: ma[0], speed: 1, ai_start_sec: 2, ai_end_sec: 6, user_tier: null, tier: 'solid', ai_tier: 'solid', seen: false,
        clip: { id: clipA, recorded_at: '2026-05-01T10:00:00', event_id: ev },
      });
      expect(rows[1]).toMatchObject({
        id: ma[1], start_sec: 11, end_sec: 13, speed: 0.5, ai_start_sec: 10, ai_end_sec: 14,
        user_tier: 'hero', tier: 'hero', ai_tier: 'solid',
      });
    });
  });
});
