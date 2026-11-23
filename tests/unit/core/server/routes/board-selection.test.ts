import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setup } from '../../storyboard/_helpers.js';
import { createCutRoutes } from '../../../../../src/core/server/routes/cuts.js';

describe('PUT /board/selection', () => {
  let t: ReturnType<typeof setup>;
  let app: ReturnType<typeof createCutRoutes>;
  let dir: string;
  let cutId: number;
  let sceneId: number;
  let panelId: number;
  let momentId: number;

  const put = (body: unknown) =>
    app.request('/board/selection', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const file = () => path.join(dir, '.clippilot', 'board-selection.json');

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clippilot-selroute-'));
    t = setup();
    app = createCutRoutes(t.db, { basePath: dir });
    cutId = t.svc.createCut(t.projectId, 'Main').id;
    sceneId = t.svc.addScene(cutId, 'S').id;
    panelId = t.svc.addPanel(sceneId, { intent: 'p' }).id;
    momentId = t.addMoments(t.addClip().id, [{}])[0];
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('writes the file with updated_at and does not touch the undo history', async () => {
    const res = await put({ cut_id: cutId, scene_id: sceneId, panel_id: panelId, moment_id: momentId, drawer: 'panel', preview_moment_id: null });
    expect(res.status).toBe(200);
    const raw = JSON.parse(fs.readFileSync(file(), 'utf-8'));
    expect(raw).toMatchObject({ cut_id: cutId, scene_id: sceneId, panel_id: panelId, moment_id: momentId, drawer: 'panel', preview_moment_id: null });
    expect(raw.updated_at).toBeTruthy();
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM operations').get()).toEqual({ n: 0 });
    expect(t.svc.historyState(cutId)).toMatchObject({ can_undo: false, can_redo: false });
    const hist = await (await app.request(`/cuts/${cutId}/history`)).json() as any;
    expect(hist.data).toEqual([]);
  });

  it('overwrites on every call', async () => {
    await put({ cut_id: cutId, scene_id: sceneId });
    await put({ cut_id: cutId, scene_id: sceneId, drawer: 'moment', moment_id: momentId });
    expect(JSON.parse(fs.readFileSync(file(), 'utf-8'))).toMatchObject({ drawer: 'moment', moment_id: momentId, panel_id: null });
  });

  it('400 for a bad body, 404 for unknown ids; nothing is written', async () => {
    expect((await put({ cut_id: 'x', scene_id: sceneId })).status).toBe(400);
    expect((await put({ cut_id: cutId, scene_id: sceneId, drawer: 'sheet' })).status).toBe(400);
    expect((await put({ cut_id: 9999, scene_id: sceneId })).status).toBe(404);
    expect((await put({ cut_id: cutId, scene_id: 9999 })).status).toBe(404);
    expect((await put({ cut_id: cutId, scene_id: sceneId, panel_id: 9999 })).status).toBe(404);
    expect((await put({ cut_id: cutId, scene_id: sceneId, moment_id: 9999 })).status).toBe(404);
    expect((await put({ cut_id: cutId, scene_id: sceneId, preview_moment_id: 9999 })).status).toBe(404);
    expect(fs.existsSync(file())).toBe(false);
  });

  it('GET /cuts/:id/head returns the latest op id and undo/redo state', async () => {
    const head = async () => ((await (await app.request(`/cuts/${cutId}/head`)).json()) as any).data;
    expect(await head()).toEqual({ op_id: null, can_undo: false, can_redo: false, undo_label: null, redo_label: null });
    t.svc.command(cutId, 'Rename', () => t.svc.renameScene(sceneId, 'T'));
    const h = await head();
    expect(h).toMatchObject({ can_undo: true, can_redo: false, undo_label: 'Rename' });
    expect(typeof h.op_id).toBe('number');
    t.svc.undo(cutId);
    expect(await head()).toMatchObject({ op_id: h.op_id, can_undo: false, can_redo: true, redo_label: 'Rename' });
    expect((await app.request('/cuts/9999/head')).status).toBe(404);
  });
});
