import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setup } from './_helpers.js';
import {
  readBoardSelection, writeBoardSelection, selectionFile, parseSelection, checkSelection, resolveBoardContext,
  type BoardSelection,
} from '../../../../src/core/storyboard/selection.js';

describe('board selection file + context', () => {
  let t: ReturnType<typeof setup>;
  let dir: string;
  let cutId: number;
  let sceneId: number;
  let clip: number;
  let ms: number[];

  const sel = (o: Partial<BoardSelection> = {}): BoardSelection => ({
    cut_id: cutId, scene_id: sceneId, panel_id: null, moment_id: null, drawer: null, preview_moment_id: null, ...o,
  });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clippilot-sel-'));
    t = setup();
    t.db.prepare("INSERT INTO events (project_id, name, source, sort_order) VALUES (?, 'Beach', 'folder', 0)").run(t.projectId);
    cutId = t.svc.createCut(t.projectId, 'Main').id;
    sceneId = t.svc.addScene(cutId, 'Arrival', { eventId: 1 }).id;
    clip = t.addClip().id;
    t.db.prepare("UPDATE clips SET event_id = 1, recorded_at = '2026-01-01T10:00:00Z' WHERE id = ?").run(clip);
    ms = t.addMoments(clip, [
      { start_sec: 2, end_sec: 6, tier: 'solid' },
      { start_sec: 10, end_sec: 14, tier: 'solid' },
      { start_sec: 20, end_sec: 24, tier: 'solid' },
    ]);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  describe('file', () => {
    it('writes atomically to .clippilot/board-selection.json with updated_at and no temp file left', () => {
      writeBoardSelection(dir, sel({ drawer: 'moment', moment_id: ms[0] }));
      const file = selectionFile(dir);
      expect(file).toBe(path.join(dir, '.clippilot', 'board-selection.json'));
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
      expect(raw).toMatchObject({ cut_id: cutId, scene_id: sceneId, moment_id: ms[0], drawer: 'moment' });
      expect(raw.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(fs.readdirSync(path.join(dir, '.clippilot'))).toEqual(['board-selection.json']);
      expect(readBoardSelection(dir)).toEqual(raw);
    });
    it('read returns null for a missing or corrupt file', () => {
      expect(readBoardSelection(dir)).toBeNull();
      fs.mkdirSync(path.join(dir, '.clippilot'));
      fs.writeFileSync(selectionFile(dir), '{nope');
      expect(readBoardSelection(dir)).toBeNull();
    });
  });

  describe('parse / check', () => {
    it('parses nulls and rejects wrong types', () => {
      expect(parseSelection({ cut_id: 1, scene_id: 2 })).toEqual({
        cut_id: 1, scene_id: 2, panel_id: null, moment_id: null, drawer: null, preview_moment_id: null,
      });
      expect(() => parseSelection({ cut_id: 'x', scene_id: 2 })).toThrow(/cut_id/);
      expect(() => parseSelection({ cut_id: 1, scene_id: 2, drawer: 'side' })).toThrow(/drawer/);
      expect(() => parseSelection({ cut_id: 1, scene_id: 2, panel_id: 1.5 })).toThrow(/panel_id/);
    });
    it('check: 404 for unknown ids, 400 when scene/panel do not belong together', () => {
      const p = t.svc.addPanel(sceneId, { intent: 'x' }).id;
      expect(checkSelection(t.db, sel({ panel_id: p, moment_id: ms[0], preview_moment_id: ms[1] }))).toBeNull();
      expect(checkSelection(t.db, sel({ cut_id: 999 }))).toMatchObject({ status: 404 });
      expect(checkSelection(t.db, sel({ scene_id: 999 }))).toMatchObject({ status: 404 });
      expect(checkSelection(t.db, sel({ panel_id: 999 }))).toMatchObject({ status: 404 });
      expect(checkSelection(t.db, sel({ moment_id: 999 }))).toMatchObject({ status: 404 });
      expect(checkSelection(t.db, sel({ preview_moment_id: 999 }))).toMatchObject({ status: 404 });
      const other = t.svc.createCut(t.projectId, 'Other').id;
      expect(checkSelection(t.db, sel({ cut_id: other }))).toMatchObject({ status: 400 });
      const otherScene = t.svc.addScene(other, 'o').id;
      const op = t.svc.addPanel(otherScene, { intent: 'y' }).id;
      expect(checkSelection(t.db, sel({ panel_id: op }))).toMatchObject({ status: 400 });
    });
  });

  describe('alternatives', () => {
    it('same event + role + shot, not rejected/hidden, stars first then recording time', () => {
      const set = (id: number, role: string | null, shot: string | null, tier = 'solid') =>
        t.db.prepare('UPDATE highlights SET role = ?, shot = ?, tier = ? WHERE id = ?').run(role, shot, tier, id);
      const more = t.addMoments(clip, [{ start_sec: 25, end_sec: 28 }, { start_sec: 1, end_sec: 1.8 }]);
      set(ms[0], 'action', 'wide'); set(ms[1], 'action', 'wide'); set(ms[2], 'action', 'wide');
      set(more[0], 'action', 'wide'); set(more[1], 'action', 'close');
      t.db.prepare("UPDATE highlights SET user_tier = 'hero' WHERE id = ?").run(ms[2]);
      t.db.prepare("UPDATE highlights SET status = 'rejected' WHERE id = ?").run(more[0]);
      expect(t.svc.alternatives(ms[0])).toEqual([ms[2], ms[1]]);
      // a hidden clip's moments and another event's moments are out
      const c2 = t.addClip().id;
      t.db.prepare('UPDATE clips SET event_id = 1, hidden = 1 WHERE id = ?').run(c2);
      const h = t.addMoments(c2, [{}])[0]; set(h, 'action', 'wide');
      const c3 = t.addClip().id;
      t.db.prepare("INSERT INTO events (project_id, name, source, sort_order) VALUES (?, 'Town', 'folder', 1)").run(t.projectId);
      t.db.prepare('UPDATE clips SET event_id = 2 WHERE id = ?').run(c3);
      const e = t.addMoments(c3, [{}])[0]; set(e, 'action', 'wide');
      expect(t.svc.alternatives(ms[0])).toEqual([ms[2], ms[1]]);
    });
    it('orders by recording time across clips, null role/shot match each other, unknown moment -> []', () => {
      const c2 = t.addClip().id;
      t.db.prepare("UPDATE clips SET event_id = 1, recorded_at = '2026-01-01T09:00:00Z' WHERE id = ?").run(c2);
      const early = t.addMoments(c2, [{ start_sec: 3, end_sec: 5 }])[0];
      expect(t.svc.alternatives(ms[0])).toEqual([early, ms[1], ms[2]]);
      expect(t.svc.alternatives(99999)).toEqual([]);
    });
  });

  describe('resolveBoardContext', () => {
    it('resolves cut, scene, panel with its moment, drawer, preview and the focused moment', () => {
      t.db.prepare("UPDATE highlights SET role = 'action', shot = 'wide', description = 'wave' WHERE clip_id = ?").run(clip);
      const p = t.svc.addPanel(sceneId, { intent: 'Arrival shot', momentId: ms[0] }).id;
      t.svc.addPanel(sceneId, { intent: 'second' });
      const ctx = resolveBoardContext(t.db, { ...sel({ panel_id: p, drawer: 'panel', preview_moment_id: ms[1] }), updated_at: 'T' });
      expect(ctx.stale).toBe(false);
      expect(ctx.updated_at).toBe('T');
      expect(ctx.cut).toEqual({ id: cutId, name: 'Main' });
      expect(ctx.scene).toEqual({ id: sceneId, name: 'Arrival', position: 0, event: { id: 1, name: 'Beach' } });
      expect(ctx.panel).toMatchObject({ id: p, number: 1, intent: 'Arrival shot', state: 'filled', source: 'ai', moment_id: ms[0] });
      expect(ctx.drawer).toBe('panel');
      expect(ctx.preview_moment_id).toBe(ms[1]);
      expect(ctx.moment).toMatchObject({
        id: ms[1], focus: 'preview', clip: { id: clip, file_name: 'c1.mp4' }, start_sec: 10, end_sec: 14, speed: 1,
        tier: 'solid', shot: 'wide', role: 'action', status: 'proposed', description: 'wave',
      });
      expect(ctx.moment!.alternatives).toEqual([ms[0], ms[2]]);
    });
    it('focus falls back to the panel moment, then the drawer moment; second panel is number 2', () => {
      const p1 = t.svc.addPanel(sceneId, { intent: 'a', momentId: ms[0] }).id;
      const p2 = t.svc.addPanel(sceneId, { intent: 'b' }).id;
      expect(resolveBoardContext(t.db, sel({ panel_id: p1, moment_id: ms[2] })).moment).toMatchObject({ id: ms[0], focus: 'panel' });
      const c = resolveBoardContext(t.db, sel({ panel_id: p2, moment_id: ms[2], drawer: 'moment' }));
      expect(c.panel).toMatchObject({ number: 2, state: 'gap', moment_id: null });
      expect(c.moment).toMatchObject({ id: ms[2], focus: 'drawer' });
      expect(resolveBoardContext(t.db, sel()).moment).toBeNull();
    });
    it('uses the first candidate as the panel moment and the effective tier', () => {
      const p = t.svc.addPanel(sceneId, { intent: 'c', candidates: [ms[1], ms[2]] }).id;
      t.db.prepare("UPDATE highlights SET user_tier = 'hero' WHERE id = ?").run(ms[1]);
      const c = resolveBoardContext(t.db, sel({ panel_id: p }));
      expect(c.panel).toMatchObject({ state: 'candidates', moment_id: ms[1] });
      expect(c.moment).toMatchObject({ id: ms[1], tier: 'hero' });
    });
    it('stale ids: resolves what still exists and flags stale', () => {
      const p = t.svc.addPanel(sceneId, { intent: 'a', momentId: ms[0] }).id;
      t.svc.deletePanel(p);
      t.db.prepare('DELETE FROM highlights WHERE id = ?').run(ms[2]);
      const c = resolveBoardContext(t.db, sel({ panel_id: p, moment_id: ms[2], preview_moment_id: ms[1], drawer: 'panel' }));
      expect(c.stale).toBe(true);
      expect(c.cut).toEqual({ id: cutId, name: 'Main' });
      expect(c.scene).toMatchObject({ id: sceneId });
      expect(c.panel).toBeNull();
      expect(c.moment).toMatchObject({ id: ms[1], focus: 'preview' });
      t.svc.deleteScene(sceneId);
      const d = resolveBoardContext(t.db, sel());
      expect(d.stale).toBe(true);
      expect(d.scene).toBeNull();
      t.svc.deleteCut(cutId);
      const e = resolveBoardContext(t.db, sel());
      expect(e.cut).toBeNull();
      expect(e.stale).toBe(true);
    });
  });
});
