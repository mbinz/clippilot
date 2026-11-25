import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { createDb } from '../../../src/db/connection.js';
import { runMigrations } from '../../../src/db/migrations/runner.js';
import { ClipRepository } from '../../../src/db/repositories/clip.repository.js';
import { ProjectRepository } from '../../../src/db/repositories/project.repository.js';
import { MotionRepository } from '../../../src/db/repositories/motion.repository.js';
import { StoryboardService } from '../../../src/core/storyboard/service.js';
import { registerShakesCommands } from '../../../src/cli/commands/shakes.js';
import { registerMotionCommand } from '../../../src/cli/commands/motion.js';
import type { ClipFrameSource } from '../../../src/core/motion/frames.js';
import type { ShakeVerifier } from '../../../src/core/shakes/index.js';

let dir: string;
let cwd: string;
let home: string | undefined;
let key: string | undefined;
let out: string[];
let err: string[];

const verifier = (answer: object): ShakeVerifier & { n: number } => {
  const v = { n: 0, async verify() { v.n++; return JSON.stringify(answer); } };
  return v;
};

function seed(): { cutId: number } {
  fs.mkdirSync(path.join(dir, '.clippilot'), { recursive: true });
  const db = createDb(path.join(dir, '.clippilot', 'clippilot.db'));
  runMigrations(db);
  const pid = new ProjectRepository(db).findOrCreate('trip').id;
  const clip = new ClipRepository(db).insert({
    project_id: pid, file_path: '/v/a.mp4', proxy_path: null, file_hash: 'h1', file_size: 1, duration_sec: 30,
    resolution: '1920x1080', fps: 25, nb_frames: null, has_video: 1, has_audio: 1, codec: null,
    recorded_at: null, start_timecode: null, location: null, manual_tags: null, people: null,
  });
  const ins = db.prepare("INSERT INTO highlights (clip_id, start_sec, end_sec, description, tier) VALUES (?, ?, ?, 'm', 'solid')");
  ins.run(clip.id, 2, 12);
  ins.run(clip.id, 20, 26);
  new MotionRepository(db).save(clip.id, {
    curve: { fps: 25, width: 320, srcWidth: 1920, dx: new Int8Array(750), dy: new Int8Array(750), change: new Float32Array(750) },
    medianResidual: 0.1, continuous: false,
    shakes: [{ start_sec: 1.5, end_sec: 3, peak_sec: 2, peak: 5, jump_pct: 1, jump_px: 20, disagreement: 0.1, moving_scene: false, confidence: 'high' }],
  });
  const svc = new StoryboardService(db);
  const cut = svc.createCut(pid, 'Main');
  svc.addPanel(svc.addScene(cut.id, 'S').id, { intent: 'x', momentId: 1, source: 'ai' });
  db.close();
  return { cutId: cut.id };
}

async function run(inject: Parameters<typeof registerShakesCommands>[1], ...args: string[]): Promise<void> {
  out = []; err = [];
  const program = new Command();
  registerShakesCommands(program, { exists: () => true, ...inject });
  await program.parseAsync(['node', 'clippilot', ...args]);
}
const rows = () => {
  const db = createDb(path.join(dir, '.clippilot', 'clippilot.db'));
  const r = db.prepare('SELECT id, start_sec, end_sec, shake_status FROM highlights ORDER BY id').all();
  db.close();
  return r;
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clippilot-sh-'));
  cwd = process.cwd();
  home = process.env['CLIPPILOT_HOME'];
  key = process.env['GEMINI_API_KEY'];
  delete process.env['GEMINI_API_KEY'];
  process.env['CLIPPILOT_HOME'] = path.join(dir, 'home');
  process.chdir(dir);
  process.exitCode = undefined;
  vi.spyOn(console, 'log').mockImplementation((...a) => { out.push(a.join(' ')); });
  vi.spyOn(console, 'error').mockImplementation((...a) => { err.push(a.join(' ')); });
});

afterEach(async () => {
  await new Promise((r) => setTimeout(r, 30));
  process.chdir(cwd);
  if (home === undefined) delete process.env['CLIPPILOT_HOME']; else process.env['CLIPPILOT_HOME'] = home;
  if (key !== undefined) process.env['GEMINI_API_KEY'] = key;
  vi.restoreAllMocks();
  process.exitCode = undefined;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('clippilot shakes fix', () => {
  it('--dry-run --json: per moment plan, totals, no Gemini call, nothing written', async () => {
    seed();
    const v = verifier({ keeps_content: true, reason: 'ok' });
    await run({ verifier: v }, 'shakes', 'fix', '--dry-run', '--json');
    expect(v.n).toBe(0);
    const j = JSON.parse(out.join('\n'));
    expect(j.dry_run).toBe(true);
    expect(j.moments).toHaveLength(2);
    expect(j.moments[0]).toMatchObject({ moment_id: 1, status: null, plan: { kind: 'trim', parts: [{ start: 3.04, end: 12 }] }, verdict: null });
    expect(j.moments[1]).toMatchObject({ moment_id: 2, status: 'clean', plan: { kind: 'clean' } });
    expect(j.totals).toMatchObject({ checked: 2, unverified: 1, clean: 1, gemini_calls: 0 });
    expect(rows()).toEqual([{ id: 1, start_sec: 2, end_sec: 12, shake_status: null }, { id: 2, start_sec: 20, end_sec: 26, shake_status: null }]);
  });

  it('applies with the verifier, reports verdict + reason; --cut limits it; a second run does not ask again', async () => {
    const { cutId } = seed();
    const v = verifier({ keeps_content: true, reason: 'only wobble removed' });
    await run({ verifier: v }, 'shakes', 'fix', '--cut', String(cutId), '--json');
    const j = JSON.parse(out.join('\n'));
    expect(j.moments).toHaveLength(1);
    expect(j.moments[0]).toMatchObject({ status: 'fixed', applied: true, verdict: { keeps_content: true, reason: 'only wobble removed' } });
    expect(j.totals).toMatchObject({ fixed: 1, gemini_calls: 1 });
    expect(rows()[0]).toMatchObject({ start_sec: 3.04, shake_status: 'fixed' });
    await run({ verifier: v }, 'shakes', 'fix', '--cut', String(cutId), '--json');
    expect(v.n).toBe(1);
  });

  it('without a Gemini key: plans are not applied, status stays null, a hint is printed', async () => {
    seed();
    await run({}, 'shakes', 'fix', '--json');
    const j = JSON.parse(out.join('\n'));
    expect(j.totals).toMatchObject({ unverified: 1, fixed: 0 });
    expect(j.hint).toMatch(/Gemini API key/);
    expect(err.join('\n')).toMatch(/not applied/);
    expect(rows()[0]).toMatchObject({ start_sec: 2, shake_status: null });
    expect(process.exitCode).toBeUndefined();
  });

  it('an unknown cut is an error', async () => {
    seed();
    await run({}, 'shakes', 'fix', '--cut', '99');
    expect(process.exitCode).toBe(1);
    expect(err.join('\n')).toMatch(/Cut "99" not found/);
  });
});

describe('clippilot motion runs the shake fit', () => {
  const still: ClipFrameSource = async () => { throw new Error('the clip already has a curve, nothing to decode'); };
  const motion = async (inject: Parameters<typeof registerMotionCommand>[1]) => {
    out = []; err = [];
    const program = new Command();
    registerMotionCommand(program, { source: still, exists: () => true, ...inject });
    await program.parseAsync(['node', 'clippilot', 'motion', '--json']);
    return JSON.parse(out.join('\n'));
  };

  it('after the measurement: with the AI check the plans are applied', async () => {
    seed();
    const v = verifier({ keeps_content: true, reason: 'ok' });
    const j = await motion({ verifier: v });
    expect(j).toMatchObject({ skipped: 1, shake_fit: { fixed: 1, clean: 1, gemini_calls: 1 } });
    expect(rows()[0]).toMatchObject({ start_sec: 3.04, shake_status: 'fixed' });
  });

  it('without a Gemini key: verification is skipped, plans stay unapplied (status null), hint printed', async () => {
    seed();
    const j = await motion({});
    expect(j.shake_fit).toMatchObject({ fixed: 0, unverified: 1, gemini_calls: 0 });
    expect(j.shake_fit.hint).toMatch(/Gemini API key/);
    expect(err.join('\n')).toMatch(/not applied/);
    expect(rows()[0]).toMatchObject({ start_sec: 2, shake_status: null });
  });
});
