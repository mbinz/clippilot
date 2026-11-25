import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setup } from '../storyboard/_helpers.js';
import { HighlightRepository } from '../../../../src/db/repositories/highlight.repository.js';
import {
  FindingsFileSchema, validateAgainstCut, ReviewStore, panelLabels,
} from '../../../../src/core/critic/findings.js';

const finding = (o: Record<string, unknown> = {}) => ({
  id: 'F1', severity: 'must', kind: 'trim', message: 'too long', ...o,
});
const file = (findings: unknown[], o: Record<string, unknown> = {}) => ({ critic: 'cut', cut_id: 1, round: 1, findings, ...o });

function fixture() {
  const s = setup();
  const clip = s.addClip();
  const [m1, m2, m3] = s.addMoments(clip.id, [{}, {}, {}]);
  const cut = s.svc.createCut(s.projectId, 'Main');
  const sc1 = s.svc.addScene(cut.id, 'Beach');
  const sc2 = s.svc.addScene(cut.id, 'Town');
  const p1 = s.svc.addPanel(sc1.id, { intent: 'wave', momentId: m1!, source: 'ai' });
  const p2 = s.svc.addPanel(sc2.id, { intent: 'street', momentId: m2!, source: 'ai' });
  return { ...s, clip, m1: m1!, m2: m2!, m3: m3!, cut, sc1, sc2, p1, p2 };
}

describe('findings schema [D-12]', () => {
  it('accepts a minimal file and defaults protected to false', () => {
    const r = FindingsFileSchema.parse(file([finding()]));
    expect(r.findings[0]!.protected).toBe(false);
  });

  it.each([
    ['severity', { severity: 'huge' }],
    ['kind', { kind: 'explode' }],
    ['message', { message: '' }],
    ['id', { id: '' }],
  ])('rejects a bad %s', (_n, o) => {
    expect(FindingsFileSchema.safeParse(file([finding(o)])).success).toBe(false);
  });

  it('rejects an unknown critic and round 0', () => {
    expect(FindingsFileSchema.safeParse(file([], { critic: 'x' })).success).toBe(false);
    expect(FindingsFileSchema.safeParse(file([], { round: 0 })).success).toBe(false);
  });
});

describe('validateAgainstCut', () => {
  it('reports ids that are not in the cut and duplicate finding ids', () => {
    const f = fixture();
    const tree = f.svc.getCut(f.cut.id)!;
    const bad = FindingsFileSchema.parse(file([
      finding({ id: 'A', panel_id: 9999 }), finding({ id: 'B', moment_id: 9999 }),
      finding({ id: 'C', scene_id: 9999 }), finding({ id: 'C' }),
    ], { cut_id: f.cut.id }));
    const r = validateAgainstCut(bad, tree, new HighlightRepository(f.db));
    expect(r.errors).toHaveLength(4);
    expect(r.errors.join('\n')).toMatch(/panel 9999/);
    expect(r.errors.join('\n')).toMatch(/moment 9999/);
    expect(r.errors.join('\n')).toMatch(/scene 9999/);
    expect(r.errors.join('\n')).toMatch(/duplicate finding id "C"/);
  });

  it('rejects a file for another cut', () => {
    const f = fixture();
    const r = validateAgainstCut(FindingsFileSchema.parse(file([], { cut_id: 77 })), f.svc.getCut(f.cut.id)!, new HighlightRepository(f.db));
    expect(r.errors[0]).toMatch(/cut 77/);
  });

  it('recomputes protected from the DB and ignores what the file claims', () => {
    const f = fixture();
    f.db.prepare("UPDATE highlights SET status = 'confirmed' WHERE id = ?").run(f.m1);
    const tree = f.svc.getCut(f.cut.id)!;
    const parsed = FindingsFileSchema.parse(file([
      finding({ id: 'A', panel_id: f.p1.id, protected: false }),
      finding({ id: 'B', moment_id: f.m2, protected: true }),
      finding({ id: 'C', moment_id: f.m1 }),
      finding({ id: 'D', scene_id: f.sc1.id }),
    ], { cut_id: f.cut.id }));
    const r = validateAgainstCut(parsed, tree, new HighlightRepository(f.db));
    expect(r.errors).toEqual([]);
    expect(r.file.findings.map((x) => x.protected)).toEqual([true, false, true, false]);
  });

  it('a panel placed by the user is protected even when its moment is untouched', () => {
    const f = fixture();
    f.db.prepare("UPDATE story_segments SET source = 'user' WHERE id = ?").run(f.p2.id);
    const parsed = FindingsFileSchema.parse(file([finding({ panel_id: f.p2.id })], { cut_id: f.cut.id }));
    const r = validateAgainstCut(parsed, f.svc.getCut(f.cut.id)!, new HighlightRepository(f.db));
    expect(r.file.findings[0]!.protected).toBe(true);
  });

  it('accepts a moment that is only a candidate of a panel', () => {
    const f = fixture();
    const p = f.svc.addPanel(f.sc1.id, { intent: 'x', candidates: [f.m2, f.m3], source: 'ai' });
    expect(p.state).toBe('candidates');
    const parsed = FindingsFileSchema.parse(file([finding({ moment_id: f.m3 })], { cut_id: f.cut.id }));
    expect(validateAgainstCut(parsed, f.svc.getCut(f.cut.id)!, new HighlightRepository(f.db)).errors).toEqual([]);
  });
});

describe('panelLabels', () => {
  it('labels panels S<scene>·P<panel> by position in the cut', () => {
    const f = fixture();
    const second = f.svc.addPanel(f.sc2.id, { intent: 'y', source: 'ai' });
    const labels = panelLabels(f.svc.getCut(f.cut.id)!);
    expect(labels.get(f.p1.id)).toBe('S1·P1');
    expect(labels.get(f.p2.id)).toBe('S2·P1');
    expect(labels.get(second.id)).toBe('S2·P2');
  });
});

describe('ReviewStore', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clippilot-reviews-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const parsed = (o: Record<string, unknown> = {}, fs_: unknown[] = [finding()]) => FindingsFileSchema.parse(file(fs_, o));

  it('saves as <timestamp>-<critic>-r<round>.json and lists newest first', () => {
    const store = new ReviewStore(dir);
    const a = store.save(parsed({ round: 1 }), new Date('2026-11-25T10:00:00Z'));
    const b = store.save(parsed({ critic: 'story', round: 2 }), new Date('2026-11-25T11:00:00Z'));
    expect(a.file).toMatch(/^20261125-\d{6}-cut-r1\.json$/);
    expect(b.file).toMatch(/-story-r2\.json$/);
    expect(store.list().map((x) => x.file)).toEqual([b.file, a.file]);
    expect(store.list(2)).toEqual([]);
    expect(store.list(1)).toHaveLength(2);
  });

  it('never overwrites a file saved within the same second', () => {
    const store = new ReviewStore(dir);
    const t = new Date('2026-11-25T10:00:00Z');
    expect(store.save(parsed(), t).file).not.toBe(store.save(parsed(), t).file);
  });

  it('loads by name, path or "latest"', () => {
    const store = new ReviewStore(dir);
    store.save(parsed({ round: 1 }), new Date('2026-11-25T10:00:00Z'));
    const b = store.save(parsed({ round: 2 }), new Date('2026-11-25T11:00:00Z'));
    expect(store.load('latest').round).toBe(2);
    expect(store.load(b.file).round).toBe(2);
    expect(store.load(path.join(dir, b.file)).round).toBe(2);
    expect(() => store.load('nope.json')).toThrow(/not found/);
  });

  it('resolves findings and rejects unknown ones', () => {
    const store = new ReviewStore(dir);
    const a = store.save(parsed(), new Date('2026-11-25T10:00:00Z'));
    store.resolve(a.file, 'F1', 'applied', 'trimmed to 3 s');
    expect(store.load(a.file).resolutions['F1']).toMatchObject({ status: 'applied', note: 'trimmed to 3 s' });
    expect(() => store.resolve(a.file, 'F9', 'skipped')).toThrow(/F9/);
    expect(() => store.resolve(a.file, 'F1', 'bogus' as never)).toThrow(/applied, skipped or protected/);
  });

  it('summarises per round: severities, resolutions and the applied changes', () => {
    const store = new ReviewStore(dir);
    const r1 = store.save(parsed({ round: 1 }, [
      finding({ id: 'a', severity: 'must', kind: 'trim', panel_id: 5, proposal: { start_sec: 12, end_sec: 15.5 } }),
      finding({ id: 'b', severity: 'should', kind: 'remove', panel_id: 6, message: 'dup' }),
      finding({ id: 'c', severity: 'nit', kind: 'other' }),
      finding({ id: 'd', severity: 'must', kind: 'replace', protected: true }),
    ]), new Date('2026-11-25T10:00:00Z'));
    store.save(parsed({ critic: 'story', round: 1 }, [finding({ id: 's', severity: 'should', kind: 'reorder' })]), new Date('2026-11-25T10:05:00Z'));
    store.resolve(r1.file, 'a', 'applied');
    store.resolve(r1.file, 'b', 'skipped');
    store.resolve(r1.file, 'd', 'protected');
    const s = store.summary(1, new Map([[5, 'S1·P2']]));
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({
      round: 1, findings: 5,
      by_severity: { must: 2, should: 2, nit: 1 },
      by_resolution: { applied: 1, skipped: 1, protected: 1, open: 2 },
    });
    expect(s[0]!.applied).toEqual(['S1·P2 trim: 12.0–15.5 s']);
  });
});

describe('structured proposals', () => {
  const check = (f: ReturnType<typeof fixture>, over: Record<string, unknown>) => {
    const parsed = FindingsFileSchema.safeParse(file([finding({ id: 'P', panel_id: f.p1.id, ...over })], { cut_id: f.cut.id }));
    if (!parsed.success) return parsed.error.issues.map((i) => i.message);
    return validateAgainstCut(parsed.data, f.svc.getCut(f.cut.id)!, new HighlightRepository(f.db)).errors;
  };

  it('accepts valid proposals of every kind', () => {
    const f = fixture();
    // m1 = 1-5 s in a 30 s clip; p1 is the only panel in sc1; sc2 holds p2
    expect(check(f, { kind: 'trim', proposal: { start_sec: 1.5, end_sec: 4, note: 'tighter' } })).toEqual([]);
    expect(check(f, { kind: 'replace', proposal: { moment_id: f.m3 } })).toEqual([]);
    expect(check(f, { kind: 'remove', proposal: {} })).toEqual([]);
    expect(check(f, { kind: 'reorder', proposal: { position: 1 } })).toEqual([]);
    expect(check(f, { kind: 'move_scene', proposal: { to_scene_id: f.sc2.id, position: 1 } })).toEqual([]);
    expect(check(f, { kind: 'speed', proposal: { speed: 0.5 } })).toEqual([]);
    expect(check(f, { kind: 'cut_out', proposal: { from: 2, to: 3 } })).toEqual([]);
    expect(check(f, { kind: 'other' })).toEqual([]);
    expect(check(f, { kind: 'trim' })).toEqual([]);
  });

  it.each([
    ['trim outside the clip', { kind: 'trim', proposal: { start_sec: 1, end_sec: 31 } }, /clip/],
    ['trim negative start', { kind: 'trim', proposal: { start_sec: -1, end_sec: 3 } }, /clip/],
    ['trim shorter than 0.5 s', { kind: 'trim', proposal: { start_sec: 2, end_sec: 2.5 } }, /0\.5/],
    ['replace with unknown moment', { kind: 'replace', proposal: { moment_id: 99999 } }, /moment 99999/],
    ['reorder to position 0', { kind: 'reorder', proposal: { position: 0 } }, /position/],
    ['reorder beyond the scene', { kind: 'reorder', proposal: { position: 5 } }, /position/],
    ['move to a scene outside the cut', { kind: 'move_scene', proposal: { to_scene_id: 99999 } }, /scene 99999/],
    ['speed 2', { kind: 'speed', proposal: { speed: 2 } }, /./],
    ['cut_out outside the moment', { kind: 'cut_out', proposal: { from: 0, to: 3 } }, /moment/],
    ['cut_out reversed', { kind: 'cut_out', proposal: { from: 4, to: 3 } }, /moment|from/],
    ['a field of another kind', { kind: 'remove', proposal: { start_sec: 1 } }, /remove/],
    ['a proposal on other', { kind: 'other', proposal: { note: 'x' } }, /other/],
    ['a string proposal', { kind: 'trim', proposal: 'out at 3' }, /./],
  ])('rejects %s', (_n, over, re) => {
    const f = fixture();
    expect(check(f, over as Record<string, unknown>).join('\n')).toMatch(re);
  });

  it('rejects replacing with a rejected moment', () => {
    const f = fixture();
    f.db.prepare("UPDATE highlights SET status = 'rejected' WHERE id = ?").run(f.m3);
    expect(check(f, { kind: 'replace', proposal: { moment_id: f.m3 } }).join('\n')).toMatch(/rejected/);
  });

  it('reads stored files with a string proposal as {note}, and summarises other shapes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clippilot-reviews-'));
    const store = new ReviewStore(dir);
    const saved = store.save(FindingsFileSchema.parse(file([finding()])));
    const p = path.join(dir, saved.file);
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
    raw.findings[0].proposal = 'out at 3.0';
    fs.writeFileSync(p, JSON.stringify(raw));
    expect(store.load(saved.file).findings[0]!.proposal).toEqual({ note: 'out at 3.0' });
    store.resolve(saved.file, 'F1', 'applied');
    expect(store.summary(1)[0]!.applied).toEqual(['cut trim: out at 3.0']);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
