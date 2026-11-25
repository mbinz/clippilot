import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { createDb } from '../../../src/db/connection.js';
import { runMigrations } from '../../../src/db/migrations/runner.js';
import { ClipRepository } from '../../../src/db/repositories/clip.repository.js';
import { ProjectRepository } from '../../../src/db/repositories/project.repository.js';
import { registerMotionCommand } from '../../../src/cli/commands/motion.js';
import type { ClipFrameSource } from '../../../src/core/motion/frames.js';
import { MotionRepository } from '../../../src/db/repositories/motion.repository.js';

let dir: string;
let cwd: string;
let home: string | undefined;
let out: string[];

const W = 64, H = 36;
function noise(seed: number): Uint8Array {
  let s = seed;
  const a = new Uint8Array(W * H);
  for (let i = 0; i < a.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; a[i] = (s >> 16) & 255; }
  return a;
}
const still: ClipFrameSource = async () => {
  const f = noise(1);
  return { w: W, h: H, srcWidth: 1920, frames: (async function* () { for (let i = 0; i < 10; i++) yield f; })() };
};

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
  const ins = db.prepare("INSERT INTO highlights (clip_id, start_sec, end_sec, description, tier) VALUES (?, ?, ?, 'm', 'solid')");
  ins.run(clip.id, 1, 4);
  ins.run(clip.id, 8, 12);
  db.close();
}

async function run(...args: string[]): Promise<void> {
  out = [];
  const program = new Command();
  registerMotionCommand(program, { source: still, exists: () => true });
  await program.parseAsync(['node', 'clippilot', ...args]);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clippilot-mo-'));
  cwd = process.cwd();
  home = process.env['CLIPPILOT_HOME'];
  process.env['CLIPPILOT_HOME'] = path.join(dir, 'home');
  process.chdir(dir);
  process.exitCode = undefined;
  vi.spyOn(console, 'log').mockImplementation((...a) => { out.push(a.join(' ')); });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  await new Promise((r) => setTimeout(r, 30));
  process.chdir(cwd);
  if (home === undefined) delete process.env['CLIPPILOT_HOME']; else process.env['CLIPPILOT_HOME'] = home;
  vi.restoreAllMocks();
  process.exitCode = undefined;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('clippilot motion', () => {
  it('--json reports clips measured / skipped / failed, shakes, shake fit totals and the band counts', async () => {
    seed();
    await run('motion', '--json');
    expect(process.exitCode).toBeUndefined();
    expect(JSON.parse(out.join('\n'))).toMatchObject({
      project: 'trip', measured: 1, skipped: 0, failed: 0, shakes: { high: 0, low: 0 }, shake_fit: { checked: 2, clean: 2, fixed: 0 },
      bands: { locked: 2, stabilize: 0, shaky: 0 }, errors: [],
    });
  });

  it('stores the curve per clip and the moment columns', async () => {
    seed();
    await run('motion', '--json');
    const db = createDb(path.join(dir, '.clippilot', 'clippilot.db'));
    expect(new MotionRepository(db).clipIdsWithCurve()).toEqual([1]);
    const row = db.prepare('SELECT jitter_score, motion_start_sec, motion_end_sec FROM highlights WHERE id = 1').get();
    expect(row).toEqual({ jitter_score: 0, motion_start_sec: 1, motion_end_sec: 4 });
    db.close();
  });

  it('a second run skips the clip; --force measures it again; text output names the numbers', async () => {
    seed();
    await run('motion', '--json');
    await run('motion', '--json');
    expect(JSON.parse(out.join('\n'))).toMatchObject({ measured: 0, skipped: 1 });
    await run('motion', '--force');
    expect(out.join('\n')).toMatch(/Measured 1 clips, skipped 0/);
    expect(out.join('\n')).toMatch(/Shakes: 0/);
  });

  it('uses the jitter thresholds from the config', async () => {
    seed();
    fs.mkdirSync(path.join(dir, 'home'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'home', 'config.json'), JSON.stringify({ jitter_locked_max: 0 }));
    await run('motion', '--json');
    expect(JSON.parse(out.join('\n')).bands).toEqual({ locked: 0, stabilize: 2, shaky: 0 });
  });
});
