import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDb } from '../../../src/db/connection.js';
import { runMigrations } from '../../../src/db/migrations/runner.js';
import { ClipRepository } from '../../../src/db/repositories/clip.repository.js';
import { ProjectRepository } from '../../../src/db/repositories/project.repository.js';
import { createProgram } from '../../../src/cli/index.js';

let dir: string;
let cwd: string;
let home: string | undefined;
let out: string[];
let errs: string[];

function seed(hasAudio: number): void {
  fs.mkdirSync(path.join(dir, '.clippilot'), { recursive: true });
  const db = createDb(path.join(dir, '.clippilot', 'clippilot.db'));
  runMigrations(db);
  const pid = new ProjectRepository(db).findOrCreate('trip').id;
  new ClipRepository(db).insert({
    project_id: pid, file_path: '/v/a.mp4', proxy_path: null, file_hash: 'h1', file_size: 1, duration_sec: 30,
    resolution: '1920x1080', fps: 25, nb_frames: null, has_video: 1, has_audio: hasAudio, codec: null,
    recorded_at: null, start_timecode: null, location: null, manual_tags: null, people: null,
  });
  db.close();
}

async function run(...args: string[]): Promise<void> {
  out = [];
  errs = [];
  await createProgram().parseAsync(['node', 'clippilot', ...args]);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clippilot-tr-'));
  cwd = process.cwd();
  home = process.env['CLIPPILOT_HOME'];
  process.env['CLIPPILOT_HOME'] = path.join(dir, 'home');
  process.chdir(dir);
  process.exitCode = undefined;
  vi.spyOn(console, 'log').mockImplementation((...a) => { out.push(a.join(' ')); });
  vi.spyOn(console, 'error').mockImplementation((...a) => { errs.push(a.join(' ')); });
});

afterEach(async () => {
  await new Promise((r) => setTimeout(r, 30)); // createDb's mkdir is not awaited
  process.chdir(cwd);
  if (home === undefined) delete process.env['CLIPPILOT_HOME']; else process.env['CLIPPILOT_HOME'] = home;
  vi.restoreAllMocks();
  process.exitCode = undefined;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('clippilot transcribe', () => {
  it('without the model file: exit 1 with a clear message, nothing is skipped silently', async () => {
    seed(1);
    fs.mkdirSync(path.join(dir, 'home'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'home', 'config.json'), JSON.stringify({ whisper_model: path.join(dir, 'missing', 'ggml.bin') }));
    await run('transcribe');
    expect(process.exitCode).toBe(1);
    expect(errs.join('\n')).toMatch(/Whisper model not found/);
    expect(errs.join('\n')).toMatch(/whisper_model/);
  });

  it('--json reports counts (clips without audio are skipped)', async () => {
    seed(0);
    const model = path.join(dir, 'ggml-test.bin');
    fs.writeFileSync(model, 'x');
    fs.mkdirSync(path.join(dir, 'home'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'home', 'config.json'), JSON.stringify({ whisper_model: model, whisper_vad_model: path.join(dir, 'no-vad.bin') }));
    await run('transcribe', '--json');
    expect(process.exitCode).toBeUndefined();
    expect(JSON.parse(out.join('\n'))).toMatchObject({ project: 'trip', transcribed: 0, skipped_no_audio: 1, skipped_existing: 0, snapped: 0, dropped_language: 0, dropped_segments: {}, errors: [] });
    // one warning (not one per clip) that VAD is off
    expect(errs.filter((e) => /VAD/.test(e))).toHaveLength(1);
  });
});
