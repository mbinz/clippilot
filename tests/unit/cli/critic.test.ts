import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { createDb } from '../../../src/db/connection.js';
import { runMigrations } from '../../../src/db/migrations/runner.js';
import { ClipRepository } from '../../../src/db/repositories/clip.repository.js';
import { ProjectRepository } from '../../../src/db/repositories/project.repository.js';
import { HighlightRepository } from '../../../src/db/repositories/highlight.repository.js';
import { StoryboardService } from '../../../src/core/storyboard/service.js';
import { registerCriticCommands, type CriticInject } from '../../../src/cli/commands/critic.js';
import { createProgram } from '../../../src/cli/index.js';

let dir: string;
let cwd: string;
let home: string | undefined;
let out: string[];
let errs: string[];
let ids: { cut: number; p1: number; p2: number; m1: number; m2: number; scene: number };

function seed(): void {
  fs.mkdirSync(path.join(dir, '.clippilot'), { recursive: true });
  const db = createDb(path.join(dir, '.clippilot', 'clippilot.db'));
  runMigrations(db);
  const pid = new ProjectRepository(db).findOrCreate('trip').id;
  const clip = new ClipRepository(db).insert({
    project_id: pid, file_path: '/v/a.mp4', proxy_path: null, file_hash: 'h1', file_size: 1, duration_sec: 30,
    resolution: '1920x1080', fps: 25, nb_frames: null, has_video: 1, has_audio: 1, codec: null,
    recorded_at: null, start_timecode: null, location: null, manual_tags: null, people: null,
  });
  new HighlightRepository(db).replaceForClip(clip.id, [
    { start_sec: 1, end_sec: 5, description: 'wave', tier: 'hero' },
    { start_sec: 10, end_sec: 14, description: 'sand', tier: 'filler' },
  ]);
  const [m1, m2] = (db.prepare('SELECT id FROM highlights ORDER BY id').all() as { id: number }[]).map((r) => r.id);
  db.prepare("UPDATE highlights SET status = 'confirmed' WHERE id = ?").run(m1);
  const svc = new StoryboardService(db);
  const cut = svc.getOrCreateMainCut(pid);
  svc.setBrief(cut.id, { target_sec: 60, audience: 'family', mood: 'calm', must_have: [], ending: 'sunset' }, 'confirmed');
  const scene = svc.addScene(cut.id, 'Beach');
  const p1 = svc.addPanel(scene.id, { intent: 'wave', momentId: m1!, source: 'ai' });
  const p2 = svc.addPanel(scene.id, { intent: 'sand', momentId: m2!, source: 'ai' });
  ids = { cut: cut.id, p1: p1.id, p2: p2.id, m1: m1!, m2: m2!, scene: scene.id };
  db.close();
}

async function run(inject: CriticInject, ...args: string[]): Promise<any> {
  out = [];
  errs = [];
  const program = new Command();
  registerCriticCommands(program, inject);
  await program.parseAsync(['node', 'clippilot', 'critic', ...args]);
  return out.length ? JSON.parse(out.join('\n')) : null;
}

const findingsFile = (o: Record<string, unknown> = {}, findings?: unknown[]) => {
  const p = path.join(dir, 'f.json');
  fs.writeFileSync(p, JSON.stringify({
    critic: 'cut', cut_id: ids.cut, round: 1,
    findings: findings ?? [
      { id: 'F1', severity: 'must', kind: 'trim', panel_id: ids.p1, message: 'long', proposal: 'out at 3', protected: false },
      { id: 'F2', severity: 'should', kind: 'remove', panel_id: ids.p2, message: 'dup' },
    ],
    ...o,
  }));
  return p;
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clippilot-critic-'));
  cwd = process.cwd();
  home = process.env['CLIPPILOT_HOME'];
  process.env['CLIPPILOT_HOME'] = path.join(dir, 'home');
  process.chdir(dir);
  process.exitCode = undefined;
  vi.spyOn(console, 'log').mockImplementation((...a) => { out.push(a.join(' ')); });
  vi.spyOn(console, 'error').mockImplementation((...a) => { errs.push(a.join(' ')); });
  seed();
});

afterEach(async () => {
  await new Promise((r) => setTimeout(r, 30));
  process.chdir(cwd);
  if (home === undefined) delete process.env['CLIPPILOT_HOME']; else process.env['CLIPPILOT_HOME'] = home;
  process.exitCode = undefined;
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('critic is registered in the program', () => {
  it('createProgram has the critic group with all verbs', () => {
    const critic = createProgram().commands.find((c) => c.name() === 'critic')!;
    expect(critic.commands.map((c) => c.name()).sort()).toEqual(['context', 'list', 'resolve', 'save', 'show', 'story', 'summary']);
  });
});

describe('critic save / list / show / resolve / summary', () => {
  it('saves a valid file under .clippilot/reviews with protected recomputed from the DB', async () => {
    const r = await run({}, 'save', '--file', findingsFile(), '--json');
    expect(r).toMatchObject({ critic: 'cut', cut_id: ids.cut, round: 1, findings: 2, protected: 1 });
    expect(fs.existsSync(path.join(dir, '.clippilot', 'reviews', r.file))).toBe(true);
    const shown = await run({}, 'show', r.file, '--json');
    expect(shown.findings.map((f: any) => f.protected)).toEqual([true, false]);
  });

  it('refuses a file with ids that are not in the cut, naming them, and stores nothing', async () => {
    await run({}, 'save', '--file', findingsFile({}, [{ id: 'X', severity: 'must', kind: 'trim', panel_id: 4242, message: 'm' }]));
    expect(process.exitCode).toBe(1);
    expect(errs.join('\n')).toMatch(/panel 4242/);
    expect(fs.existsSync(path.join(dir, '.clippilot', 'reviews'))).toBe(false);
  });

  it('refuses a schema-invalid file', async () => {
    await run({}, 'save', '--file', findingsFile({ round: 0 }));
    expect(process.exitCode).toBe(1);
    expect(errs.join('\n')).toMatch(/round/);
  });

  it('lists reviews of the cut with open counts, resolves findings and summarises the applied changes', async () => {
    const saved = await run({}, 'save', '--file', findingsFile(), '--json');
    await run({}, 'resolve', saved.file, 'F1', 'applied', '--note', 'trimmed');
    expect(process.exitCode).toBeUndefined();
    const list = await run({}, 'list', '--json');
    expect(list).toEqual([expect.objectContaining({ file: saved.file, critic: 'cut', round: 1, findings: 2, open: 1 })]);
    const sum = await run({}, 'summary', '--json');
    expect(sum.cut_id).toBe(ids.cut);
    expect(sum.rounds[0]).toMatchObject({ round: 1, by_resolution: { applied: 1, open: 1 }, applied: ['S1·P1 trim: out at 3'] });
  });

  it('rejects an unknown finding or resolution', async () => {
    const saved = await run({}, 'save', '--file', findingsFile(), '--json');
    await run({}, 'resolve', saved.file, 'nope', 'applied');
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
    await run({}, 'resolve', saved.file, 'F1', 'maybe');
    expect(process.exitCode).toBe(1);
  });

  it('show latest returns the newest review', async () => {
    await run({}, 'save', '--file', findingsFile({ round: 1 }), '--json');
    await run({}, 'save', '--file', findingsFile({ round: 2 }), '--json');
    expect((await run({}, 'show', 'latest', '--json')).round).toBe(2);
  });
});

describe('critic context', () => {
  it('writes context.json and prints the panels (strips fail without real media and say so)', async () => {
    const outDir = path.join(dir, 'ctx');
    const ctx = await run({}, 'context', '--out', outDir, '--json');
    expect(ctx.cut.id).toBe(ids.cut);
    expect(ctx.panels).toHaveLength(2);
    expect(ctx.panels[0]).toMatchObject({ label: 'S1·P1', next_panel_id: ids.p2 });
    expect(ctx.panels[0].moment).toMatchObject({ id: ids.m1, protected: true, protected_reasons: ['confirmed'] });
    expect(ctx.panels[0].strip_error).toBeTruthy();
    expect(fs.existsSync(path.join(outDir, 'context.json'))).toBe(true);
  });
});

describe('critic story [D-11]', () => {
  const fakeRender: CriticInject['render'] = async (args) => { fs.writeFileSync(args[args.length - 1]!, 'mp4'); };
  const answer = () => JSON.stringify({ findings: [{ id: 'S1', severity: 'should', kind: 'reorder', panel_id: ids.p2, message: 'sand first' }] });

  it('without --yes renders, prints estimate / duration / preview and exits 2 without calling the model', async () => {
    const client = { review: vi.fn(async () => answer()) };
    const r = await run({ client, render: fakeRender }, 'story', '--json');
    expect(process.exitCode).toBe(2);
    expect(client.review).not.toHaveBeenCalled();
    expect(r).toMatchObject({ duration_sec: 8, model: 'gemini-3.1-pro-preview' });
    expect(r.estimate_usd).toBeGreaterThan(0);
    expect(fs.realpathSync(r.preview)).toBe(fs.realpathSync(path.join(dir, '.clippilot', 'previews', `cut-${ids.cut}.mp4`)));
    expect(fs.existsSync(r.preview)).toBe(true);
    expect(fs.existsSync(path.join(dir, '.clippilot', 'reviews'))).toBe(false);
  });

  it('with --yes asks the configured model, validates and saves the findings as critic "story"', async () => {
    fs.mkdirSync(path.join(dir, 'home'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'home', 'config.json'), JSON.stringify({ story_critic_model: 'my-model' }));
    const client = { review: vi.fn(async (_p: string, _pr: unknown, _m: string) => answer()) };
    const r = await run({ client, render: fakeRender }, 'story', '--yes', '--round', '2', '--json');
    expect(process.exitCode).toBeUndefined();
    expect(client.review.mock.calls[0]![2]).toBe('my-model');
    expect(r).toMatchObject({ round: 2, findings: 1, protected: 0 });
    const stored = await run({}, 'show', r.file, '--json');
    expect(stored).toMatchObject({ critic: 'story', cut_id: ids.cut, round: 2 });
  });

  it('with --yes and a 404 model-not-found names the model and points at story_critic_model', async () => {
    const client = { review: vi.fn(async () => { throw Object.assign(new Error('models/gemini-3.1-pro-preview is not found'), { status: 404 }); }) };
    await run({ client, render: fakeRender }, 'story', '--yes', '--json');
    expect(process.exitCode).toBe(1);
    const msg = errs.join('\n');
    expect(msg).toMatch(/gemini-3\.1-pro-preview/);
    expect(msg).toMatch(/story_critic_model/);
  });

  it('with --yes and no API key (and no injected client) fails before spending anything', async () => {
    const prev = process.env['GEMINI_API_KEY'];
    delete process.env['GEMINI_API_KEY'];
    await run({ render: fakeRender }, 'story', '--yes', '--json');
    if (prev !== undefined) process.env['GEMINI_API_KEY'] = prev;
    expect(process.exitCode).toBe(1);
    expect(errs.join('\n')).toMatch(/API key/);
  });
});
