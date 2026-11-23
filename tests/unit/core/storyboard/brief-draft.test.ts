import { describe, it, expect, beforeEach } from 'vitest';
import { setup } from './_helpers.js';
import { DraftValidationError } from '../../../../src/core/storyboard/schema.js';

describe('brief', () => {
  let t: ReturnType<typeof setup>;
  let cutId: number;
  beforeEach(() => {
    t = setup();
    cutId = t.svc.createCut(t.projectId, 'Main').id;
  });
  const brief = {
    target_sec: 180, audience: 'family', mood: 'warm, relaxed', ending: 'sunset',
    must_have: [{ moment_id: 3, text: 'the jump' }, { text: 'kids laughing' }],
  };

  it('stores a valid brief as proposed, then confirmed', () => {
    t.svc.setBrief(cutId, brief, 'proposed');
    let tree = t.svc.getCut(cutId)!;
    expect(tree.brief).toEqual(brief);
    expect(tree.brief_state).toBe('proposed');
    t.svc.setBrief(cutId, { ...brief, notes: 'no drone' }, 'confirmed');
    tree = t.svc.getCut(cutId)!;
    expect(tree.brief_state).toBe('confirmed');
    expect((tree.brief as any).notes).toBe('no drone');
  });

  it('requires audience', () => {
    const { audience, ...rest } = brief;
    void audience;
    expect(() => t.svc.setBrief(cutId, rest, 'proposed')).toThrow(/audience/);
    expect(t.svc.getCut(cutId)!.brief_state).toBe('none');
  });

  it('rejects bad target, bad must_have and bad state', () => {
    expect(() => t.svc.setBrief(cutId, { ...brief, target_sec: 0 }, 'proposed')).toThrow(/target_sec/);
    expect(() => t.svc.setBrief(cutId, { ...brief, must_have: [{ moment_id: 1 }] }, 'proposed')).toThrow(/text/);
    expect(() => t.svc.setBrief(cutId, brief, 'none' as never)).toThrow(/state/);
  });

  it('rejects an unknown cut', () => {
    expect(() => t.svc.setBrief(999, brief, 'proposed')).toThrow(/not found/);
  });
});

describe('applyDraft', () => {
  let t: ReturnType<typeof setup>;
  let cutId: number;
  let clip: { id: number };
  let m: number[];
  beforeEach(() => {
    t = setup();
    cutId = t.svc.createCut(t.projectId, 'Main').id;
    clip = t.addClip({ fps: 120, duration: 30 });
    m = t.addMoments(clip.id, [
      { start_sec: 1, end_sec: 5, suggested_speed: 0.5 },
      { start_sec: 6, end_sec: 10 },
      { start_sec: 12, end_sec: 16 },
      { start_sec: 18, end_sec: 22 },
    ]);
  });
  const errorsOf = (fn: () => unknown): string[] => {
    try { fn(); } catch (e) { expect(e).toBeInstanceOf(DraftValidationError); return (e as DraftValidationError).errors; }
    throw new Error('expected DraftValidationError');
  };

  it('applies a valid draft into a tree (filled, candidates, gap; source ai; moments stay proposed)', () => {
    const ev = t.db.prepare("INSERT INTO events (project_id, name, source) VALUES (?, 'Beach', 'folder')").run(t.projectId).lastInsertRowid as number;
    const res = t.svc.applyDraft(cutId, {
      scenes: [
        { name: 'Arrival', event_id: ev, notes: 'n', panels: [
          { intent: 'hero shot', moment_id: m[0] },
          { intent: 'trimmed', moment_id: m[1], start_sec: 7, end_sec: 9, speed: 1 },
        ] },
        { name: 'Beach', panels: [
          { intent: 'pick one', candidates: [m[2], m[3]] },
          { intent: 'need drone shot' },
        ] },
      ],
    }, { mode: 'replace' });
    expect(res).toEqual({ scenes: 2, panels: 4 });

    const tree = t.svc.getCut(cutId)!;
    expect(tree.scenes.map((s) => s.name)).toEqual(['Arrival', 'Beach']);
    expect(tree.scenes[0].event).toMatchObject({ id: ev });
    expect(tree.scenes[0].notes).toBe('n');
    const [a, b] = tree.scenes[0].panels;
    expect(a).toMatchObject({ state: 'filled', source: 'ai', start_sec: 1, end_sec: 5, speed: 0.5, moment_id: m[0] });
    expect(b).toMatchObject({ state: 'filled', start_sec: 7, end_sec: 9, speed: 1 });
    expect(tree.scenes[1].panels[0]).toMatchObject({ state: 'candidates', source: 'ai' });
    expect(tree.scenes[1].panels[0].candidates.map((c) => c.id)).toEqual([m[2], m[3]]);
    expect(tree.scenes[1].panels[1]).toMatchObject({ state: 'gap', intent: 'need drone shot' });
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM highlights WHERE status != 'proposed'").get()).toEqual({ n: 0 });
  });

  it('collects every validation error at once and changes nothing', () => {
    const rejected = m[1];
    t.svc.rejectMoment(rejected);
    const hiddenClip = t.addClip();
    const [hm] = t.addMoments(hiddenClip.id, [{}]);
    t.svc.hideClip(hiddenClip.id);
    const otherProject = t.db.prepare("INSERT INTO projects (name) VALUES ('q')").run().lastInsertRowid as number;
    const foreignClip = t.addClip({ projectId: otherProject });
    const [fm] = t.addMoments(foreignClip.id, [{}]);
    const lowFps = t.addClip({ fps: 25 });
    const [lm] = t.addMoments(lowFps.id, [{}]);

    const errors = errorsOf(() => t.svc.applyDraft(cutId, {
      scenes: [
        { name: 'S', event_id: 9999, panels: [
          { intent: 'a', moment_id: 9999 },
          { intent: 'b', moment_id: rejected },
          { intent: 'c', moment_id: hm },
          { intent: 'd', moment_id: fm },
          { intent: 'e', candidates: [m[0], 8888] },
          { intent: 'f', moment_id: m[0], start_sec: 0, end_sec: 99 },
          { intent: 'g', moment_id: m[0], start_sec: 3, end_sec: 3.2 },
          { intent: 'h', moment_id: lm, speed: 0.5 },
        ] },
      ],
    }, { mode: 'replace' }));
    expect(errors).toHaveLength(9);
    expect(errors.join('\n')).toMatch(/event 9999/);
    expect(errors.join('\n')).toMatch(/scenes\.0\.panels\.0.*moment 9999.*not found/);
    expect(errors.join('\n')).toMatch(/panels\.1.*rejected/);
    expect(errors.join('\n')).toMatch(/panels\.2.*hidden/);
    expect(errors.join('\n')).toMatch(/panels\.3.*project/);
    expect(errors.join('\n')).toMatch(/panels\.4.*moment 8888/);
    expect(errors.join('\n')).toMatch(/panels\.5.*clip duration/);
    expect(errors.join('\n')).toMatch(/panels\.6.*0\.5/);
    expect(errors.join('\n')).toMatch(/panels\.7.*fps/);
    expect(t.svc.getCut(cutId)!.scenes).toEqual([]);
  });

  it('reports structural errors (schema) with paths, including candidate count and both moment_id and candidates', () => {
    const errors = errorsOf(() => t.svc.applyDraft(cutId, {
      scenes: [{ name: '', panels: [
        { intent: 'x', candidates: [m[0]] },
        { intent: 'y', candidates: [1, 2, 3, 4, 5, 6] },
        { intent: 'z', moment_id: m[0], candidates: [m[1], m[2]] },
        { moment_id: m[0] },
      ] }],
    }, { mode: 'append' }));
    expect(errors.length).toBeGreaterThanOrEqual(5);
    expect(errors.join('\n')).toMatch(/scenes\.0\.name/);
    expect(errors.join('\n')).toMatch(/scenes\.0\.panels\.0\.candidates/);
    expect(errors.join('\n')).toMatch(/scenes\.0\.panels\.1\.candidates/);
    expect(errors.join('\n')).toMatch(/scenes\.0\.panels\.3\.intent/);
  });

  it('rejects duplicate candidates', () => {
    const errors = errorsOf(() => t.svc.applyDraft(cutId, {
      scenes: [{ name: 'S', panels: [{ intent: 'x', candidates: [m[0], m[0]] }] }],
    }, { mode: 'append' }));
    expect(errors.join('\n')).toMatch(/duplicate/);
  });

  it('append keeps existing scenes and adds new ones after them', () => {
    t.svc.applyDraft(cutId, { scenes: [{ name: 'One', panels: [{ intent: 'a', moment_id: m[0] }] }] }, { mode: 'replace' });
    t.svc.applyDraft(cutId, { scenes: [{ name: 'Two', panels: [{ intent: 'b', moment_id: m[1] }] }] }, { mode: 'append' });
    const tree = t.svc.getCut(cutId)!;
    expect(tree.scenes.map((s) => s.name)).toEqual(['One', 'Two']);
    expect(tree.scenes.map((s) => s.panels.length)).toEqual([1, 1]);
  });

  it('replace discards ai panels and old scenes but keeps user panels in the same-named scene', () => {
    t.svc.applyDraft(cutId, { scenes: [
      { name: 'Arrival', panels: [{ intent: 'ai one', moment_id: m[0] }, { intent: 'ai gap' }] },
      { name: 'Beach', panels: [{ intent: 'ai two', moment_id: m[1] }] },
    ] }, { mode: 'replace' });
    const beach = t.svc.getCut(cutId)!.scenes[1];
    // the user places a moment into the gap-less panel, i.e. takes over panel "ai two"
    t.svc.placeMoment(beach.panels[0].id, m[2]);
    const userPanelId = beach.panels[0].id;

    t.svc.applyDraft(cutId, { scenes: [
      { name: 'Beach', panels: [{ intent: 'new ai', moment_id: m[3] }] },
      { name: 'Sunset', panels: [] },
    ] }, { mode: 'replace' });

    const tree = t.svc.getCut(cutId)!;
    expect(tree.scenes.map((s) => s.name)).toEqual(['Beach', 'Sunset']);
    expect(tree.scenes[0].panels.map((p) => p.intent)).toEqual(['new ai', 'ai two']);
    expect(tree.scenes[0].panels[1]).toMatchObject({ id: userPanelId, source: 'user', moment_id: m[2] });
    expect(tree.scenes[1].panels).toEqual([]);
    expect(tree.totals.panels).toBe(2);
  });

  it('replace puts user panels of a vanished scene into a trailing "Kept" scene', () => {
    t.svc.applyDraft(cutId, { scenes: [{ name: 'Old', panels: [{ intent: 'x', moment_id: m[0] }] }] }, { mode: 'replace' });
    const p = t.svc.getCut(cutId)!.scenes[0].panels[0];
    t.svc.placeMoment(p.id, m[1]);
    t.svc.applyDraft(cutId, { scenes: [{ name: 'New', panels: [] }] }, { mode: 'replace' });
    const tree = t.svc.getCut(cutId)!;
    expect(tree.scenes.map((s) => s.name)).toEqual(['New', 'Kept']);
    expect(tree.scenes[1].panels.map((x) => x.id)).toEqual([p.id]);
  });

  it('replace on an empty cut works and an invalid replace keeps the old content', () => {
    t.svc.applyDraft(cutId, { scenes: [{ name: 'Old', panels: [{ intent: 'x', moment_id: m[0] }] }] }, { mode: 'replace' });
    errorsOf(() => t.svc.applyDraft(cutId, { scenes: [{ name: 'Bad', panels: [{ intent: 'x', moment_id: 9999 }] }] }, { mode: 'replace' }));
    expect(t.svc.getCut(cutId)!.scenes.map((s) => s.name)).toEqual(['Old']);
  });

  it('rejects an unknown cut', () => {
    expect(() => t.svc.applyDraft(999, { scenes: [] }, { mode: 'append' })).toThrow(/not found/);
  });

  it('draft panels without explicit in/out/speed play the whole moment at its gated default speed', () => {
    const clip = t.addClip({ fps: 25, duration: 60 });
    const [long] = t.addMoments(clip.id, [{ start_sec: 10, end_sec: 30, suggested_speed: 0.5 }]);
    t.svc.applyDraft(cutId, { scenes: [{ name: 'S', panels: [{ intent: 'x', moment_id: long }] }] }, { mode: 'replace' });
    expect(t.svc.getCut(cutId)!.scenes[0].panels[0]).toMatchObject({ start_sec: 10, end_sec: 30, speed: 1 });
  });
});
