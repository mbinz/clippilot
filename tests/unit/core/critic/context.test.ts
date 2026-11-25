import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { setup } from '../storyboard/_helpers.js';
import { HighlightRepository } from '../../../../src/db/repositories/highlight.repository.js';
import { TranscriptRepository } from '../../../../src/db/repositories/transcript.repository.js';
import { buildContext } from '../../../../src/core/critic/context.js';
import type { FrameGrabber } from '../../../../src/core/critic/strips.js';

let out: string;
beforeEach(() => { out = fs.mkdtempSync(path.join(os.tmpdir(), 'clippilot-ctx-')); });
afterEach(() => { fs.rmSync(out, { recursive: true, force: true }); });

const grabbed: { file: string; t: number }[] = [];
const grab: FrameGrabber = async (file, t, p) => {
  grabbed.push({ file, t });
  await sharp({ create: { width: 64, height: 36, channels: 3, background: '#335577' } }).png().toFile(p);
};

function fixture() {
  const s = setup();
  const clipA = s.addClip({ duration: 30 });
  const clipB = s.addClip({ duration: 30 });
  s.db.prepare("UPDATE clips SET proxy_path = '/p/a-proxy.mp4' WHERE id = ?").run(clipA.id);
  const [a1, a2] = s.addMoments(clipA.id, [{ start_sec: 2, end_sec: 6, description: 'wave', tier: 'hero' }, { start_sec: 10, end_sec: 12 }]);
  const [b1] = s.addMoments(clipB.id, [{ start_sec: 1, end_sec: 3, description: 'town' }]);
  s.db.prepare("UPDATE highlights SET shot = 'wide', role = 'action', audio_keep = 1, dup_group = 7 WHERE id IN (?, ?)").run(a1, b1);
  s.db.prepare("UPDATE highlights SET status = 'confirmed' WHERE id = ?").run(a1);
  s.db.prepare("UPDATE highlights SET speed = 0.5, jitter_score = 0.1, jitter_max_px = 2, camera_motion = 1.5, frame_change = 0.04, motion_start_sec = 2, motion_end_sec = 6 WHERE id = ?").run(a1);
  const cut = s.svc.createCut(s.projectId, 'Main');
  s.svc.setBrief(cut.id, { target_sec: 60, audience: 'family', mood: 'calm', must_have: [], ending: 'sunset' }, 'confirmed');
  const sc1 = s.svc.addScene(cut.id, 'Beach');
  const sc2 = s.svc.addScene(cut.id, 'Town');
  const p1 = s.svc.addPanel(sc1.id, { intent: 'opening wave', momentId: a1!, source: 'ai' });
  const p2 = s.svc.addPanel(sc2.id, { intent: 'pick one', candidates: [b1!, a2!], source: 'ai' });
  const p3 = s.svc.addPanel(sc2.id, { intent: 'tbd', source: 'ai' });
  return { ...s, clipA, clipB, a1: a1!, a2: a2!, b1: b1!, cut, p1, p2, p3 };
}

describe('buildContext', () => {
  it('describes the brief and every panel with its moment, protection and neighbours', async () => {
    const f = fixture();
    const ctx = await buildContext(f.svc, new HighlightRepository(f.db), f.cut.id, out, { grab });
    expect(ctx.cut).toMatchObject({ id: f.cut.id, name: 'Main', brief_state: 'confirmed' });
    expect(ctx.brief).toMatchObject({ audience: 'family', ending: 'sunset' });
    expect(ctx.panels.map((p) => p.panel_id)).toEqual([f.p1.id, f.p2.id, f.p3.id]);

    const [p1, p2, p3] = ctx.panels;
    expect(p1).toMatchObject({
      label: 'S1·P1', scene: { id: expect.any(Number), name: 'Beach', event: null }, position: 1,
      intent: 'opening wave', state: 'filled', source: 'ai', prev_panel_id: null, next_panel_id: f.p2.id,
    });
    expect(p1!.moment).toMatchObject({
      id: f.a1, clip_id: f.clipA.id, start_sec: 2, end_sec: 6, speed: 0.5, played_sec: 8,
      tier: 'hero', shot: 'wide', role: 'action', description: 'wave', speech: null, speech_cut: null,
      jitter: { score: 0.1 }, motion: { camera: 1.5, change: 0.04 }, audio_keep: true,
      protected: true, protected_reasons: ['confirmed', 'speed'], dup_group: 7, dup_alternatives: [f.b1],
      shakes: null,
    });
    expect(p2).toMatchObject({ state: 'candidates', moment: null, candidates: [{ id: f.b1 }, { id: f.a2 }], prev_panel_id: f.p1.id, next_panel_id: f.p3.id });
    expect(p2!.strip).toBeNull();
    expect(p3).toMatchObject({ state: 'gap', next_panel_id: null, label: 'S2·P2' });
  });

  it('passes a moment\'s shakes through when the storyboard JSON has them', async () => {
    const f = fixture();
    const svc = Object.create(f.svc);
    const tree = f.svc.getCut(f.cut.id)!;
    (tree.scenes[0]!.panels[0]!.moment as unknown as Record<string, unknown>)['shakes'] = [{ start_sec: 3, end_sec: 3.5 }];
    svc.getCut = () => tree;
    const ctx = await buildContext(svc, new HighlightRepository(f.db), f.cut.id, out, { grab });
    expect(ctx.panels[0]!.moment!.shakes).toEqual([{ start_sec: 3, end_sec: 3.5 }]);
  });

  it('renders one strip PNG per filled panel from the proxy (original when there is none) and writes context.json', async () => {
    const f = fixture();
    grabbed.length = 0;
    const ctx = await buildContext(f.svc, new HighlightRepository(f.db), f.cut.id, out, { grab });
    const strip = ctx.panels[0]!.strip!;
    expect(strip.path).toBe(path.join(out, 'strips', `panel-${f.p1.id}.png`));
    expect(fs.existsSync(strip.path)).toBe(true);
    expect(strip.frames.map((x) => x.t)).toEqual([2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 5.96]);
    expect(grabbed.every((g) => g.file === '/p/a-proxy.mp4')).toBe(true);
    expect((await sharp(strip.path).metadata()).width).toBeGreaterThan(0);
    expect(JSON.parse(fs.readFileSync(path.join(out, 'context.json'), 'utf-8')).panels).toHaveLength(3);
  });

  it('uses the original file when the clip has no proxy', async () => {
    const f = fixture();
    grabbed.length = 0;
    const p = f.svc.addPanel(f.svc.getCut(f.cut.id)!.scenes[0]!.id, { intent: 'b', momentId: f.b1, source: 'ai' });
    await buildContext(f.svc, new HighlightRepository(f.db), f.cut.id, out, { grab });
    expect(grabbed.some((g) => g.file === '/v/c2.mp4')).toBe(true);
    expect(p.id).toBeGreaterThan(0);
  });

  it('keeps going when a strip cannot be rendered and says why', async () => {
    const f = fixture();
    const ctx = await buildContext(f.svc, new HighlightRepository(f.db), f.cut.id, out, { grab: async () => { throw new Error('no such file'); } });
    expect(ctx.panels[0]!.strip).toBeNull();
    expect(ctx.panels[0]!.strip_error).toMatch(/no such file/);
  });
});

describe('buildContext: richer moments', () => {
  const ctxOf = (f: ReturnType<typeof fixture>, svc = f.svc) =>
    buildContext(svc, new HighlightRepository(f.db), f.cut.id, out, { grab, db: f.db });

  function rich() {
    const f = fixture();
    f.db.prepare("UPDATE clips SET fps = 50 WHERE id = ?").run(f.clipA.id);
    const ev = Number(f.db.prepare("INSERT INTO events (project_id, name, source) VALUES (?, 'Harbour', 'folder')").run(f.projectId).lastInsertRowid);
    f.db.prepare('UPDATE clips SET event_id = ? WHERE id IN (?, ?)').run(ev, f.clipA.id, f.clipB.id);
    f.db.prepare("UPDATE highlights SET slowmo = 'light', suggested_speed = 0.5 WHERE id = ?").run(f.a1);
    new TranscriptRepository(f.db).save(f.clipA.id, 'm', {
      language: 'en', text: '', words: [],
      segments: [{ start: 0, end: 1, text: 'Hi.' }, { start: 1.5, end: 3, text: 'Look at that.' }, { start: 7, end: 9, text: 'Far.' }, { start: 12, end: 13, text: 'Too far.' }],
    } as never);
    return { f, ev };
  }

  it('adds clip fps, clip event, slowmo and suggested speed', async () => {
    const { f } = rich();
    const m = (await ctxOf(f)).panels[0]!.moment!;
    expect(m).toMatchObject({ clip_fps: 50, clip_event: 'Harbour', slowmo: 'light', suggested_speed: 0.5 });
    expect((await ctxOf(f)).panels[1]!.candidates).toHaveLength(2);
  });

  it('lists transcript sentences within 3 s of the moment, flagging those inside it; [] without a transcript', async () => {
    const { f } = rich();
    const ctx = await ctxOf(f);
    expect(ctx.panels[0]!.moment!.sentences).toEqual([
      { start: 0, end: 1, text: 'Hi.', in_moment: false },
      { start: 1.5, end: 3, text: 'Look at that.', in_moment: true },
      { start: 7, end: 9, text: 'Far.', in_moment: false },
    ]);
    const p = f.svc.addPanel(f.svc.getCut(f.cut.id)!.scenes[0]!.id, { intent: 'b', momentId: f.b1, source: 'ai' });
    const ctx2 = await ctxOf(f);
    expect(ctx2.panels.find((x) => x.panel_id === p.id)!.moment!.sentences).toEqual([]);
  });

  it('lists up to 5 alternatives (similar + duplicates), de-duplicated, without moments already in the cut', async () => {
    const { f } = rich();
    const [b2, b3] = f.addMoments(f.clipB.id, [{ start_sec: 10, end_sec: 14, description: 'x'.repeat(200), tier: 'hero' }, { start_sec: 20, end_sec: 22 }]);
    const [a3] = f.addMoments(f.clipA.id, [{ start_sec: 20, end_sec: 22 }]);
    f.db.prepare("UPDATE highlights SET shot = 'wide', role = 'action', jitter_score = 0.1, jitter_max_px = 2, camera_motion = 1, frame_change = 0.01, motion_start_sec = 10, motion_end_sec = 14 WHERE id IN (?, ?, ?)").run(b2, b3, a3);
    f.svc.addPanel(f.svc.getCut(f.cut.id)!.scenes[0]!.id, { intent: 'used', momentId: a3!, source: 'ai' });
    const alts = (await ctxOf(f)).panels[0]!.moment!.alternatives;
    const ids = alts.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(a3);
    expect(ids).not.toContain(f.a1);
    expect(ids).toEqual(expect.arrayContaining([f.b1, b2!, b3!]));
    expect(alts.length).toBeLessThanOrEqual(5);
    const alt2 = alts.find((a) => a.id === b2)!;
    expect(alt2).toMatchObject({ clip_file: 'c2.mp4', start_sec: 10, end_sec: 14, tier: 'hero', shot: 'wide', role: 'action', in_dup_group: false, high_shakes: 0 });
    expect(alt2.description).toHaveLength(120);
    expect(alt2.jitter).toMatchObject({ band: expect.any(String) });
    expect(alts.find((a) => a.id === f.b1)!.in_dup_group).toBe(true);
  });

  it('caps alternatives at 5 and counts high-confidence shakes in range', async () => {
    const { f } = rich();
    const extra = f.addMoments(f.clipB.id, Array.from({ length: 7 }, (_, i) => ({ start_sec: 10 + i * 2, end_sec: 11 + i * 2 })));
    f.db.prepare(`UPDATE highlights SET shot = 'wide', role = 'action' WHERE id IN (${extra.join(',')})`).run();
    const real = f.svc.listMoments.bind(f.svc);
    const svc = Object.create(f.svc) as typeof f.svc;
    svc.listMoments = (...a) => real(...a).map((r) => ({
      ...r, shakes: r.id === f.b1 ? [{ confidence: 'high' }, { confidence: 'low' }, { confidence: 'high' }] as never : r.shakes,
    }));
    const alts = (await ctxOf(f, svc)).panels[0]!.moment!.alternatives;
    expect(alts).toHaveLength(5);
    expect(alts.find((a) => a.id === f.b1)!.high_shakes).toBe(2);
  });

  it('notes in the strip when a regular frame was dropped near the last frame', async () => {
    const f = fixture();
    const p = f.svc.addPanel(f.svc.getCut(f.cut.id)!.scenes[0]!.id, { intent: 'short', momentId: f.b1, source: 'ai' });
    f.db.prepare('UPDATE highlights SET start_sec = 1, end_sec = 2.2 WHERE id = ?').run(f.b1);
    const ctx = await ctxOf(f);
    expect(ctx.panels.find((x) => x.panel_id === p.id)!.strip!.note).toMatch(/0\.25/);
    expect(ctx.panels[0]!.strip!.note).toBeUndefined();
  });
});
