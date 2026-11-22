import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDb } from '../../../src/db/connection.js';
import { runMigrations } from '../../../src/db/migrations/runner.js';
import { ClipRepository } from '../../../src/db/repositories/clip.repository.js';
import { ProjectRepository } from '../../../src/db/repositories/project.repository.js';
import { HighlightRepository } from '../../../src/db/repositories/highlight.repository.js';
import { createProgram } from '../../../src/cli/index.js';

let dir: string;
let cwd: string;
let out: string[];
let errs: string[];

function seed(): void {
  fs.mkdirSync(path.join(dir, '.clippilot'), { recursive: true });
  const db = createDb(path.join(dir, '.clippilot', 'clippilot.db'));
  runMigrations(db);
  const pid = new ProjectRepository(db).findOrCreate('trip').id;
  const clips = new ClipRepository(db);
  const hl = new HighlightRepository(db);
  const add = (file: string, n: number, fps: number) => clips.insert({
    project_id: pid, file_path: file, proxy_path: null, file_hash: `h${n}`, file_size: 1, duration_sec: 30,
    resolution: '1920x1080', fps, nb_frames: null, has_video: 1, has_audio: 1, codec: null,
    recorded_at: null, start_timecode: null, location: null, manual_tags: null, people: null,
  });
  const a = add('/v/a.mp4', 1, 25);
  const b = add('/v/b.mp4', 2, 60);
  hl.replaceForClip(a.id, [
    { start_sec: 1, end_sec: 5, description: 'wave', tier: 'hero' },
    { start_sec: 10, end_sec: 14, description: 'sand', tier: 'filler' },
  ]);
  hl.replaceForClip(b.id, [{ start_sec: 2, end_sec: 6, description: 'town', tier: 'solid' }]);
  db.prepare("INSERT INTO events (project_id, name, source, sort_order) VALUES (?, 'Beach', 'folder', 0)").run(pid);
  db.prepare('UPDATE clips SET event_id = 1 WHERE id = ?').run(a.id);
  db.close();
}

async function run(...args: string[]): Promise<any> {
  out = [];
  errs = [];
  await createProgram().parseAsync(['node', 'clippilot', ...args]);
  return out.length ? JSON.parse(out.join('\n')) : null;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clippilot-cut-'));
  cwd = process.cwd();
  process.chdir(dir);
  process.exitCode = undefined;
  vi.spyOn(console, 'log').mockImplementation((...a) => { out.push(a.join(' ')); });
  vi.spyOn(console, 'error').mockImplementation((...a) => { errs.push(a.join(' ')); });
  seed();
});

afterEach(async () => {
  await new Promise((r) => setTimeout(r, 30));
  process.chdir(cwd);
  vi.restoreAllMocks();
  process.exitCode = undefined;
  fs.rmSync(dir, { recursive: true, force: true });
});

const brief = { target_sec: 120, audience: 'family', mood: 'warm', must_have: [], ending: 'sunset' };

describe('clippilot cut', () => {
  it('show without id creates and shows "Main" with the documented tree shape', async () => {
    const tree = await run('cut', 'show', '--json');
    expect(tree.cut.name).toBe('Main');
    expect(Object.keys(tree).sort()).toEqual(['brief', 'brief_state', 'cut', 'scenes', 'totals']);
    expect(tree.totals).toEqual({ panels: 0, filled: 0, candidates: 0, gaps: 0, duration_sec: 0 });
    const list = await run('cut', 'list', '--json');
    expect(list.map((c: any) => c.name)).toEqual(['Main']);
  });

  it('create, rename, delete a cut', async () => {
    const c = await run('cut', 'create', 'Short');
    expect(c).toMatchObject({ name: 'Short' });
    await run('cut', 'rename', String(c.id), 'Shorter');
    expect((await run('cut', 'show', String(c.id), '--json')).cut.name).toBe('Shorter');
    await run('cut', 'delete', String(c.id));
    await run('cut', 'show', String(c.id), '--json');
    expect(process.exitCode).toBe(1);
    expect(errs.join(' ')).toMatch(/not found/);
  });

  it('brief: print, set from file (proposed), confirm', async () => {
    expect(await run('cut', 'brief', '--json')).toMatchObject({ brief: null, brief_state: 'none' });
    const f = path.join(dir, 'brief.json');
    fs.writeFileSync(f, JSON.stringify(brief));
    expect(await run('cut', 'brief', '--set-file', f)).toMatchObject({ brief_state: 'proposed', brief });
    expect(await run('cut', 'brief', '--confirm')).toMatchObject({ brief_state: 'confirmed', brief });
  });

  it('brief with an invalid file exits 1; confirm without a brief exits 1', async () => {
    const f = path.join(dir, 'bad.json');
    fs.writeFileSync(f, JSON.stringify({ target_sec: 'x' }));
    await run('cut', 'brief', '--set-file', f);
    expect(process.exitCode).toBe(1);
    expect(errs.join(' ')).toMatch(/Invalid brief/);
    process.exitCode = undefined;
    await run('cut', 'brief', '--confirm');
    expect(process.exitCode).toBe(1);
  });

  it('apply builds the tree; invalid draft exits 1 with every error; --append adds', async () => {
    const f = path.join(dir, 'draft.json');
    fs.writeFileSync(f, JSON.stringify({ scenes: [{ name: 'Arrival', event_id: 1, panels: [
      { intent: 'wave', moment_id: 1 }, { intent: 'pick', candidates: [2, 3] }, { intent: 'gap' },
    ] }] }));
    const res = await run('cut', 'apply', '--file', f);
    expect(res).toMatchObject({ scenes: 1, panels: 3 });
    const tree = await run('cut', 'show', '--json');
    expect(tree.scenes[0].event).toEqual({ id: 1, name: 'Beach' });
    expect(tree.totals).toMatchObject({ panels: 3, filled: 1, candidates: 1, gaps: 1 });

    await run('cut', 'apply', '--file', f, '--append');
    expect((await run('cut', 'show', '--json')).scenes).toHaveLength(2);

    fs.writeFileSync(f, JSON.stringify({ scenes: [{ name: 'X', panels: [
      { intent: 'a', moment_id: 99 }, { intent: 'b', moment_id: 98 },
    ] }] }));
    await run('cut', 'apply', '--file', f);
    expect(process.exitCode).toBe(1);
    expect(errs.join('\n')).toMatch(/moment 99 not found[\s\S]*moment 98 not found/);
  });
});

describe('clippilot scene / panel / moment / clip', () => {
  it('scene add/rename/move/set-event/delete', async () => {
    const a = await run('scene', 'add', 'A');
    const b = await run('scene', 'add', 'B');
    expect(b.position).toBe(1);
    await run('scene', 'rename', String(a.id), 'A2');
    await run('scene', 'move', String(b.id), '0');
    await run('scene', 'set-event', String(a.id), '1');
    let tree = await run('cut', 'show', '--json');
    expect(tree.scenes.map((s: any) => [s.name, s.event?.id ?? null])).toEqual([['B', null], ['A2', 1]]);
    await run('scene', 'set-event', String(a.id), 'none');
    await run('scene', 'delete', String(b.id));
    tree = await run('cut', 'show', '--json');
    expect(tree.scenes.map((s: any) => s.name)).toEqual(['A2']);
    expect(tree.scenes[0].event).toBeNull();
  });

  it('panel place via CLI fills it, confirms the moment; trim and speed work; bad speed exits 1', async () => {
    const s = await run('scene', 'add', 'A');
    const p = await run('panel', 'add', String(s.id), '--intent', 'wave');
    expect(p.state).toBe('gap');
    await run('panel', 'place', String(p.id), '3');
    let tree = await run('cut', 'show', '--json');
    const panel = tree.scenes[0].panels[0];
    expect(panel).toMatchObject({ state: 'filled', source: 'user', clip_id: 2, start_sec: 2, end_sec: 6 });
    expect(panel.moment.status).toBe('confirmed');
    await run('panel', 'trim', String(p.id), '2', '4');
    await run('panel', 'speed', String(p.id), '0.5');
    await run('panel', 'intent', String(p.id), 'big wave');
    tree = await run('cut', 'show', '--json');
    expect(tree.scenes[0].panels[0]).toMatchObject({ start_sec: 2, end_sec: 4, speed: 0.5, intent: 'big wave' });
    expect(tree.totals.duration_sec).toBe(4);

    const slow = await run('panel', 'add', String(s.id), '--moment', '1'); // clip at 25 fps
    await run('panel', 'speed', String(slow.id), '0.5');
    expect(process.exitCode).toBe(1);
    expect(errs.join(' ')).toMatch(/frame rate/);
  });

  it('panel add with candidates, pick, move, delete', async () => {
    const s1 = await run('scene', 'add', 'A');
    const s2 = await run('scene', 'add', 'B');
    const p = await run('panel', 'add', String(s1.id), '--intent', 'x', '--candidates', '1,3');
    expect(p.state).toBe('candidates');
    await run('panel', 'pick', String(p.id), '3');
    expect((await run('cut', 'show', '--json')).scenes[0].panels[0]).toMatchObject({ state: 'filled', clip_id: 2 });
    await run('panel', 'move', String(p.id), String(s2.id), '0');
    const tree = await run('cut', 'show', '--json');
    expect(tree.scenes.map((s: any) => s.panels.length)).toEqual([0, 1]);
    await run('panel', 'delete', String(p.id));
    expect((await run('cut', 'show', '--json')).totals.panels).toBe(0);
  });

  it('moment reject turns a filled panel into a gap; clip hide drops moments from the list', async () => {
    const s = await run('scene', 'add', 'A');
    await run('panel', 'add', String(s.id), '--moment', '1');
    await run('moment', 'reject', '1', '--reason', 'shaky');
    expect((await run('cut', 'show', '--json')).scenes[0].panels[0].state).toBe('gap');
    await run('clip', 'hide', '2');
    const rows = await run('moments', 'list', '--json');
    expect(rows.map((r: any) => r.id)).toEqual([2]);
    await run('clip', 'unhide', '2');
    expect((await run('moments', 'list', '--json')).map((r: any) => r.id)).toEqual([2, 3]);
  });

  it('moments list: row shape, --event, --min-tier, --include-rejected', async () => {
    const rows = await run('moments', 'list', '--json');
    expect(rows.map((r: any) => r.id)).toEqual([1, 2, 3]);
    expect(Object.keys(rows[0]).sort()).toEqual([
      'audio_keep', 'audio_type', 'clip_id', 'description', 'dup_group', 'end_sec', 'event_id', 'id', 'issues', 'role',
      'shot', 'slowmo', 'start_sec', 'status', 'suggested_speed', 'tier',
    ]);
    expect(rows[0]).toMatchObject({ clip_id: 1, event_id: 1, tier: 'hero', status: 'proposed', issues: [], audio_keep: false });
    expect((await run('moments', 'list', '--event', '1', '--json')).map((r: any) => r.id)).toEqual([1, 2]);
    expect((await run('moments', 'list', '--min-tier', 'solid', '--json')).map((r: any) => r.id)).toEqual([1, 3]);
    await run('moment', 'reject', '1');
    expect((await run('moments', 'list', '--json')).map((r: any) => r.id)).toEqual([2, 3]);
    expect((await run('moments', 'list', '--include-rejected', '--json')).map((r: any) => r.id)).toEqual([1, 2, 3]);
  });
});

describe('clippilot cut undo / redo / history', () => {
  it('CLI mutations are logged with labels; undo and redo restore state', async () => {
    const s = await run('scene', 'add', 'A');
    const p = await run('panel', 'add', String(s.id), '--intent', 'wave');
    await run('panel', 'place', String(p.id), '1');
    await run('panel', 'trim', String(p.id), '2', '3');
    await run('moment', 'reject', '1', '--reason', 'shaky');
    await run('clip', 'hide', '2');

    const hist = await run('cut', 'history', '--json');
    expect(hist.map((h: any) => h.label)).toEqual([
      'Hide clip b.mp4', '👎 shaky', expect.stringMatching(/^Trim panel/), 'Place moment in panel 1',
      expect.stringMatching(/panel/i), expect.stringMatching(/scene/i),
    ]);
    expect(hist[0]).toMatchObject({ undone: false });
    expect((await run('moments', 'list', '--json')).map((x: any) => x.id)).toEqual([2]);

    const u = await run('cut', 'undo', '--json');
    expect(u).toMatchObject({ label: 'Hide clip b.mp4', can_undo: true, can_redo: true });
    expect((await run('moments', 'list', '--json')).map((x: any) => x.id)).toEqual([2, 3]);
    await run('cut', 'undo', '--json');
    expect((await run('cut', 'show', '--json')).scenes[0].panels[0]).toMatchObject({ state: 'filled', moment_id: 1 });
    const r = await run('cut', 'redo', '--json');
    expect(r).toMatchObject({ label: '👎 shaky' });
    expect((await run('cut', 'show', '--json')).scenes[0].panels[0].state).toBe('gap');
  });

  it('applying a draft is a single undo step', async () => {
    const f = path.join(dir, 'd.json');
    fs.writeFileSync(f, JSON.stringify({ scenes: [{ name: 'A', panels: [{ intent: 'x', moment_id: 1 }, { intent: 'y' }] }] }));
    await run('cut', 'apply', '--file', f);
    const hist = await run('cut', 'history', '--json');
    expect(hist).toHaveLength(1);
    expect(hist[0].label).toBe('Apply draft (2 panels)');
    await run('cut', 'undo', '--json');
    expect((await run('cut', 'show', '--json')).scenes).toEqual([]);
  });

  it('accepts an explicit cut id; nothing to undo is an error', async () => {
    const c = await run('cut', 'create', 'Other');
    await run('cut', 'undo', String(c.id), '--json');
    expect(process.exitCode).toBe(1);
    expect(errs.join('\n')).toMatch(/Nothing to undo/);
  });
});

describe('clippilot export --cut', () => {
  async function build(): Promise<number> {
    const f = path.join(dir, 'draft.json');
    fs.writeFileSync(f, JSON.stringify({ scenes: [{ name: 'Arrival', panels: [
      { intent: 'wave', moment_id: 1 }, { intent: 'pick', candidates: [3, 2] }, { intent: 'gap' },
    ] }] }));
    return (await run('cut', 'apply', '--file', f)).cut_id;
  }

  it('without a value exports "Main"; reports exported and skipped gaps; candidate falls back to first', async () => {
    const id = await build();
    const outFile = path.join(dir, 'cut.otio');
    const res = await run('export', '--cut', '--format', 'otio', '--output', outFile, '--json');
    expect(res).toMatchObject({ ok: true, format: 'otio', exported: 2, skipped_gaps: 1 });
    const otio = JSON.parse(fs.readFileSync(outFile, 'utf-8'));
    expect(JSON.stringify(otio)).toContain('/v/b.mp4'); // first candidate is moment 3 (clip b)
    const res2 = await run('export', '--cut', String(id), '--format', 'otio', '--output', outFile, '--json');
    expect(res2).toMatchObject({ exported: 2, skipped_gaps: 1 });
  });

  it('--story is an alias', async () => {
    const id = await build();
    const res = await run('export', '--story', String(id), '--format', 'otio', '--output', path.join(dir, 's.otio'), '--json');
    expect(res).toMatchObject({ ok: true, exported: 2 });
  });
});
