import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDb } from '../../../src/db/connection.js';
import { runMigrations } from '../../../src/db/migrations/runner.js';
import { ProjectRepository } from '../../../src/db/repositories/project.repository.js';
import { StoryboardService } from '../../../src/core/storyboard/service.js';
import { writeBoardSelection } from '../../../src/core/storyboard/selection.js';
import { createProgram } from '../../../src/cli/index.js';

let dir: string;
let cwd: string;
let out: string[];
let errs: string[];
let ids: { cut: number; scene: number; panel: number; moment: number };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clippilot-board-'));
  fs.mkdirSync(path.join(dir, '.clippilot'), { recursive: true });
  const db = createDb(path.join(dir, '.clippilot', 'clippilot.db'));
  runMigrations(db);
  const pid = new ProjectRepository(db).findOrCreate('trip').id;
  const clip = Number(db.prepare(`INSERT INTO clips (project_id, file_path, file_hash, file_size, duration_sec, resolution, fps, has_video, has_audio)
    VALUES (?, '/v/a.mp4', 'h', 1, 30, '1920x1080', 25, 1, 1)`).run(pid).lastInsertRowid);
  const moment = Number(db.prepare(`INSERT INTO highlights (clip_id, start_sec, end_sec, description, tier, suggested_speed)
    VALUES (?, 1, 5, 'wave', 'hero', 1)`).run(clip).lastInsertRowid);
  const svc = new StoryboardService(db);
  const cut = svc.getOrCreateMainCut(pid).id;
  const scene = svc.addScene(cut, 'Beach').id;
  const panel = svc.addPanel(scene, { intent: 'Wave', momentId: moment }).id;
  ids = { cut, scene, panel, moment };
  db.close();
  cwd = process.cwd();
  process.chdir(dir);
  out = [];
  errs = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => { out.push(a.join(' ')); });
  vi.spyOn(console, 'error').mockImplementation((...a) => { errs.push(a.join(' ')); });
  process.exitCode = undefined;
});
afterEach(async () => {
  await new Promise((r) => setTimeout(r, 30));
  vi.restoreAllMocks();
  process.chdir(cwd);
  process.exitCode = undefined;
  fs.rmSync(dir, { recursive: true, force: true });
});

const run = (...args: string[]) => createProgram().parseAsync(['node', 'clippilot', 'board', 'context', ...args]);

describe('clippilot board context', () => {
  it('no selection file: message and exit code 1', async () => {
    await run();
    expect(process.exitCode).toBe(1);
    expect(errs.join('\n')).toMatch(/no board selection/i);
  });

  it('no selection file with --json: { error } on stdout, exit 1', async () => {
    await run('--json');
    expect(process.exitCode).toBe(1);
    expect(JSON.parse(out.join('\n')).error).toMatch(/no board selection/i);
  });

  it('--json prints the resolved selection', async () => {
    writeBoardSelection(dir, { cut_id: ids.cut, scene_id: ids.scene, panel_id: ids.panel, moment_id: null, drawer: 'panel', preview_moment_id: null });
    await run('--json');
    expect(process.exitCode).toBeUndefined();
    const j = JSON.parse(out.join('\n'));
    expect(j).toMatchObject({
      stale: false, cut: { id: ids.cut, name: 'Main' }, scene: { id: ids.scene, name: 'Beach' }, drawer: 'panel',
      panel: { id: ids.panel, number: 1, intent: 'Wave', moment_id: ids.moment },
      moment: { id: ids.moment, focus: 'panel', tier: 'hero', start_sec: 1, end_sec: 5, alternatives: [] },
    });
    expect(j.moment.clip.file_name).toBe('a.mp4');
  });

  it('text output mentions scene, panel and clip', async () => {
    writeBoardSelection(dir, { cut_id: ids.cut, scene_id: ids.scene, panel_id: ids.panel, moment_id: null, drawer: null, preview_moment_id: null });
    await run();
    const text = out.join('\n');
    expect(text).toContain('Beach');
    expect(text).toContain('Wave');
    expect(text).toContain('a.mp4');
  });
});
