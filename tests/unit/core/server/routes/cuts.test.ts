import { describe, it, expect, beforeEach } from 'vitest';
import { setup } from '../../storyboard/_helpers.js';
import { ThumbnailRepository } from '../../../../../src/db/repositories/thumbnail.repository.js';
import { createCutRoutes } from '../../../../../src/core/server/routes/cuts.js';
import { createApp } from '../../../../../src/core/server/index.js';

describe('Cut API routes', () => {
  let t: ReturnType<typeof setup>;
  let app: ReturnType<typeof createCutRoutes>;
  let clipA: number;
  let clipB: number;
  let ma: number[];
  let mb: number[];

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

  beforeEach(() => {
    t = setup();
    app = createCutRoutes(t.db);
    clipA = t.addClip({ fps: 60 }).id;
    clipB = t.addClip({ fps: 25 }).id;
    t.db.prepare("UPDATE clips SET proxy_path = '/x/.clippilot/proxies/a_proxy.mp4' WHERE id = ?").run(clipA);
    new ThumbnailRepository(t.db).insert({ clip_id: clipA, file_path: '/t/a_0.jpg', timestamp_sec: 0 });
    ma = t.addMoments(clipA, [{ start_sec: 2, end_sec: 6 }, { start_sec: 10, end_sec: 14 }]);
    mb = t.addMoments(clipB, [{ start_sec: 1, end_sec: 4 }]);
  });

  it('project cuts: list, create; unknown project is 404', async () => {
    expect(await ok('GET', `/projects/${t.projectId}/cuts`)).toEqual([]);
    const created = await ok('POST', `/projects/${t.projectId}/cuts`, { name: 'Main' });
    expect(created).toMatchObject({ name: 'Main' });
    expect((await ok('GET', `/projects/${t.projectId}/cuts`)).map((c: any) => c.name)).toEqual(['Main']);
    expect((await send('GET', '/projects/999/cuts')).status).toBe(404);
    expect((await send('POST', `/projects/${t.projectId}/cuts`, { name: ' ' })).status).toBe(400);
  });

  it('GET cut returns the tree with thumbnail and proxy urls; 404 when unknown', async () => {
    const cut = await ok('POST', `/projects/${t.projectId}/cuts`, { name: 'Main' });
    const scene = await ok('POST', `/cuts/${cut.id}/scenes`, { name: 'Arrival' });
    await ok('POST', `/scenes/${scene.id}/panels`, { intent: 'wave', moment_id: ma[0] });
    await ok('POST', `/scenes/${scene.id}/panels`, { intent: 'pick', candidates: [mb[0], ma[1]] });
    await ok('POST', `/scenes/${scene.id}/panels`, { intent: 'gap' });
    const tree = await ok('GET', `/cuts/${cut.id}`);
    expect(tree.totals).toMatchObject({ panels: 3, filled: 1, candidates: 1, gaps: 1 });
    const [filled, cands] = tree.scenes[0].panels;
    expect(filled.clip).toMatchObject({ id: clipA, thumbnail: '/media/thumbnails/a_0.jpg', proxy_url: '/media/proxies/a_proxy.mp4' });
    expect(cands.candidates.map((m: any) => [m.id, m.thumbnail, m.proxy_url])).toEqual([
      [mb[0], null, null], [ma[1], '/media/thumbnails/a_0.jpg', '/media/proxies/a_proxy.mp4'],
    ]);
    expect((await send('GET', '/cuts/999')).status).toBe(404);
  });

  it('rename and delete a cut; brief PUT validates and stores state', async () => {
    const cut = await ok('POST', `/projects/${t.projectId}/cuts`, { name: 'Main' });
    expect(await ok('PATCH', `/cuts/${cut.id}`, { name: 'Final' })).toMatchObject({ name: 'Final' });
    const brief = { target_sec: 90, audience: 'family', mood: 'warm', must_have: [], ending: 'sunset' };
    const res = await ok('PUT', `/cuts/${cut.id}/brief`, { brief });
    expect(res).toMatchObject({ brief, brief_state: 'proposed' });
    expect(await ok('PUT', `/cuts/${cut.id}/brief`, { brief, state: 'confirmed' })).toMatchObject({ brief_state: 'confirmed' });
    const bad = await send('PUT', `/cuts/${cut.id}/brief`, { brief: { target_sec: 'x' } });
    expect(bad.status).toBe(400);
    expect((await json(bad)).error).toMatch(/Invalid brief/);
    await ok('DELETE', `/cuts/${cut.id}`);
    expect((await send('GET', `/cuts/${cut.id}`)).status).toBe(404);
  });

  it('scene ops: add at position, rename, set event, move, delete', async () => {
    const cut = await ok('POST', `/projects/${t.projectId}/cuts`, { name: 'Main' });
    const a = await ok('POST', `/cuts/${cut.id}/scenes`, { name: 'A' });
    const b = await ok('POST', `/cuts/${cut.id}/scenes`, { name: 'B', position: 0 });
    expect(b.position).toBe(0);
    await ok('PATCH', `/scenes/${a.id}`, { name: 'A2' });
    const ev = t.db.prepare("INSERT INTO events (project_id, name, source, sort_order) VALUES (?, 'Beach', 'folder', 0)").run(t.projectId).lastInsertRowid;
    await ok('PATCH', `/scenes/${a.id}`, { event_id: Number(ev) });
    await ok('POST', `/scenes/${a.id}/move`, { position: 0 });
    let tree = await ok('GET', `/cuts/${cut.id}`);
    expect(tree.scenes.map((s: any) => [s.name, s.event?.name ?? null])).toEqual([['A2', 'Beach'], ['B', null]]);
    await ok('PATCH', `/scenes/${a.id}`, { event_id: null });
    await ok('DELETE', `/scenes/${b.id}`);
    tree = await ok('GET', `/cuts/${cut.id}`);
    expect(tree.scenes.map((s: any) => s.name)).toEqual(['A2']);
    expect((await send('PATCH', '/scenes/999', { name: 'x' })).status).toBe(400);
  });

  it('panel ops: place confirms the moment, trim, speed, intent, move, delete; errors are 400 with a message', async () => {
    const cut = await ok('POST', `/projects/${t.projectId}/cuts`, { name: 'Main' });
    const s1 = await ok('POST', `/cuts/${cut.id}/scenes`, { name: 'A' });
    const s2 = await ok('POST', `/cuts/${cut.id}/scenes`, { name: 'B' });
    const p = await ok('POST', `/scenes/${s1.id}/panels`, { intent: 'x' });
    await ok('POST', `/panels/${p.id}/place`, { moment_id: ma[0] });
    await ok('PATCH', `/panels/${p.id}`, { intent: 'wave', start_sec: 3, end_sec: 5, speed: 0.5 });
    await ok('POST', `/panels/${p.id}/move`, { scene_id: s2.id, position: 0 });
    const tree = await ok('GET', `/cuts/${cut.id}`);
    expect(tree.scenes[1].panels[0]).toMatchObject({ intent: 'wave', state: 'filled', source: 'user', start_sec: 3, end_sec: 5, speed: 0.5 });
    expect(tree.scenes[1].panels[0].moment.status).toBe('confirmed');

    const slow = await send('PATCH', `/panels/${p.id}`, { speed: 0.3 });
    expect(slow.status).toBe(400);
    expect((await json(slow)).error).toMatch(/Invalid speed/);
    expect((await send('POST', `/panels/${p.id}/place`, { moment_id: 9999 })).status).toBe(400);
    expect((await send('POST', `/panels/${p.id}/place`, {})).status).toBe(400);

    await ok('DELETE', `/panels/${p.id}`);
    expect((await ok('GET', `/cuts/${cut.id}`)).totals.panels).toBe(0);
  });

  it('pick a candidate; reject a moment turns its panel into a gap; hide/unhide a clip', async () => {
    const cut = await ok('POST', `/projects/${t.projectId}/cuts`, { name: 'Main' });
    const s = await ok('POST', `/cuts/${cut.id}/scenes`, { name: 'A' });
    const cands = await ok('POST', `/scenes/${s.id}/panels`, { candidates: [ma[0], mb[0]] });
    await ok('POST', `/panels/${cands.id}/pick`, { moment_id: mb[0] });
    let tree = await ok('GET', `/cuts/${cut.id}`);
    expect(tree.scenes[0].panels[0]).toMatchObject({ state: 'filled', clip_id: clipB });
    await ok('POST', `/moments/${mb[0]}/reject`, { reason: 'shaky', cut_id: cut.id });
    tree = await ok('GET', `/cuts/${cut.id}`);
    expect(tree.scenes[0].panels[0].state).toBe('gap');

    const other = await ok('POST', `/scenes/${s.id}/panels`, { moment_id: ma[1] });
    await ok('POST', `/clips/${clipA}/hide`, { cut_id: cut.id });
    tree = await ok('GET', `/cuts/${cut.id}`);
    expect(tree.scenes[0].panels.find((x: any) => x.id === other.id).state).toBe('gap');
    expect(t.db.prepare('SELECT hidden FROM clips WHERE id = ?').get(clipA)).toEqual({ hidden: 1 });
    await ok('POST', `/clips/${clipA}/unhide`, { cut_id: cut.id });
    expect(t.db.prepare('SELECT hidden FROM clips WHERE id = ?').get(clipA)).toEqual({ hidden: 0 });
  });

  it('is mounted under /api in the app', async () => {
    const real = createApp({ db: t.db, basePath: '/nonexistent', port: 0 });
    const res = await real.request(`/api/projects/${t.projectId}/cuts`);
    expect(res.status).toBe(200);
    const cut = await ok('POST', `/projects/${t.projectId}/cuts`, { name: 'Main' });
    const hide = await real.request(`/api/clips/${clipA}/hide`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cut_id: cut.id }),
    });
    expect(hide.status).toBe(200);
  });

  describe('history', () => {
    let cutId: number;
    let sceneId: number;
    beforeEach(async () => {
      cutId = (await ok('POST', `/projects/${t.projectId}/cuts`, { name: 'Main' })).id;
      sceneId = t.svc.addScene(cutId, 'A').id; // direct service call: not logged
    });

    it('moment and clip routes require a valid cut_id', async () => {
      for (const [url, body] of [
        [`/moments/${ma[0]}/reject`, {}], [`/clips/${clipA}/hide`, {}], [`/clips/${clipA}/unhide`, {}],
        [`/moments/${ma[0]}/reject`, { cut_id: 9999 }],
      ] as const) {
        const res = await send('POST', url, body);
        expect(res.status, url).toBe(400);
        expect((await json(res)).error).toMatch(/cut_id|Cut 9999/);
      }
      expect(t.db.prepare('SELECT hidden FROM clips WHERE id = ?').get(clipA)).toEqual({ hidden: 0 });
    });

    it('every mutating response carries history; GET history lists the labels', async () => {
      const scene2 = await ok('POST', `/cuts/${cutId}/scenes`, { name: 'B' });
      expect(scene2.history).toEqual({ can_undo: true, can_redo: false, undo_label: expect.any(String), redo_label: null });
      const panel = await ok('POST', `/scenes/${sceneId}/panels`, { intent: 'wave' });
      expect(panel.history.can_undo).toBe(true);
      const placed = await ok('POST', `/panels/${panel.id}/place`, { moment_id: ma[0] });
      expect(placed.history.undo_label).toMatch(/^Place moment in panel 1$/);
      const trimmed = await ok('PATCH', `/panels/${panel.id}`, { start_sec: 3, end_sec: 5 });
      expect(trimmed.history.undo_label).toMatch(/Trim/);
      const rejected = await ok('POST', `/moments/${ma[1]}/reject`, { reason: 'shake', cut_id: cutId });
      expect(rejected.history.undo_label).toBe('👎 shake');
      const hidden = await ok('POST', `/clips/${clipB}/hide`, { cut_id: cutId });
      expect(hidden.history.undo_label).toMatch(/^Hide clip /);
      const brief = await ok('PUT', `/cuts/${cutId}/brief`, {
        brief: { target_sec: 60, audience: 'a', mood: 'm', must_have: [], ending: 'e' }, state: 'confirmed',
      });
      expect(brief.history.undo_label).toMatch(/brief/i);
      const del = await ok('DELETE', `/panels/${panel.id}`);
      expect(del.history.can_undo).toBe(true);

      const h = await ok('GET', `/cuts/${cutId}/history`);
      expect(h.map((o: any) => o.label)).toEqual(expect.arrayContaining(['👎 shake']));
      expect(h.length).toBe(8);
      expect(h[0]).toMatchObject({ undone: false });
    });

    it('undo / redo restore state and report labels; empty history is a 400', async () => {
      expect((await send('POST', `/cuts/${cutId}/undo`)).status).toBe(400);
      const panel = await ok('POST', `/scenes/${sceneId}/panels`, { intent: 'wave' });
      await ok('POST', `/panels/${panel.id}/place`, { moment_id: ma[0] });
      const u = await ok('POST', `/cuts/${cutId}/undo`);
      expect(u).toMatchObject({ label: 'Place moment in panel 1', can_redo: true });
      expect(u.history).toMatchObject({ can_redo: true, redo_label: 'Place moment in panel 1' });
      expect((await ok('GET', `/cuts/${cutId}`)).scenes[0].panels[0].state).toBe('gap');
      const r = await ok('POST', `/cuts/${cutId}/redo`);
      expect(r.history.can_redo).toBe(false);
      expect((await ok('GET', `/cuts/${cutId}`)).scenes[0].panels[0].state).toBe('filled');
      expect((await send('POST', `/cuts/${cutId}/redo`)).status).toBe(400);
    });

    it('a failed mutation logs nothing', async () => {
      const res = await send('POST', `/scenes/${sceneId}/panels`, { moment_id: 9999 });
      expect(res.status).toBe(400);
      expect(await ok('GET', `/cuts/${cutId}/history`)).toEqual([]);
    });

    it('unknown cut: history 404', async () => {
      expect((await send('GET', '/cuts/9999/history')).status).toBe(404);
    });
  });
});
