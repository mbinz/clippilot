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
let out: string[];
let errs: string[];

function seed(): void {
  fs.mkdirSync(path.join(dir, '.clippilot'), { recursive: true }); // createDb's ensureDir is async
  const db = createDb(path.join(dir, '.clippilot', 'clippilot.db'));
  runMigrations(db);
  const pid = new ProjectRepository(db).findOrCreate('trip').id;
  const clips = new ClipRepository(db);
  const add = (file: string, at: string, n: number) => clips.insert({
    project_id: pid, file_path: file, proxy_path: null, file_hash: `h${n}`, file_size: 1, duration_sec: 10,
    resolution: null, fps: 30, nb_frames: null, has_video: 1, has_audio: 1, codec: null,
    recorded_at: at, start_timecode: null, location: null, manual_tags: null, people: null,
  });
  add('/v/Town/a.mp4', '2025-05-27T08:00:00Z', 1);
  add('/v/Town/b.mp4', '2025-05-27T08:10:00Z', 2);
  add('/v/Beach/c.mp4', '2025-05-27T12:00:00Z', 3);
  db.close();
}

async function run(...args: string[]): Promise<unknown> {
  out = [];
  errs = [];
  await createProgram().parseAsync(['node', 'clippilot', ...args]);
  return out.length ? JSON.parse(out.join('\n')) : null;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clippilot-events-'));
  cwd = process.cwd();
  process.chdir(dir);
  process.exitCode = undefined;
  vi.spyOn(console, 'log').mockImplementation((...a) => { out.push(a.join(' ')); });
  vi.spyOn(console, 'error').mockImplementation((...a) => { errs.push(a.join(' ')); });
  seed();
});

afterEach(async () => {
  await new Promise((r) => setTimeout(r, 30)); // let createDb's un-awaited async ensureDir settle
  process.chdir(cwd);
  vi.restoreAllMocks();
  process.exitCode = undefined;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('clippilot events', () => {
  it('rebuild derives events; list --json has the documented shape', async () => {
    await run('events', 'rebuild');
    const list = (await run('events', 'list', '--json')) as any[];
    expect(list).toHaveLength(2);
    expect(Object.keys(list[0]).sort()).toEqual(['clip_count', 'end', 'folder_path', 'id', 'name', 'source', 'start']);
    expect(list.map((e) => [e.name, e.clip_count, e.source])).toEqual([['Town', 2, 'folder'], ['Beach', 1, 'folder']]);
    expect(list[0].start).toBe('2025-05-27T08:00:00Z');
  });

  it('rename prints the event', async () => {
    await run('events', 'rebuild');
    const [town] = (await run('events', 'list', '--json')) as any[];
    const res = (await run('events', 'rename', String(town.id), 'Aljezur town')) as any;
    expect(res).toMatchObject({ id: town.id, name: 'Aljezur town' });
  });

  it('merge prints the merged event; split prints both parts', async () => {
    await run('events', 'rebuild');
    const [town, beach] = (await run('events', 'list', '--json')) as any[];
    const merged = (await run('events', 'merge', String(town.id), String(beach.id))) as any;
    expect(merged).toMatchObject({ id: town.id, clip_count: 3 });
    expect(((await run('events', 'list', '--json')) as any[])).toHaveLength(1);

    const clipId = 2; // b.mp4
    const parts = (await run('events', 'split', String(town.id), '--at-clip', String(clipId))) as any[];
    expect(parts.map((p) => [p.name, p.clip_count])).toEqual([['Town', 1], ['Town (2)', 2]]);
  });

  it('rebuild only fills unassigned clips; --reset starts over', async () => {
    await run('events', 'rebuild');
    const [town] = (await run('events', 'list', '--json')) as any[];
    await run('events', 'rename', String(town.id), 'Keep me');
    await run('events', 'rebuild');
    expect(((await run('events', 'list', '--json')) as any[])[0].name).toBe('Keep me');
    await run('events', 'rebuild', '--reset');
    expect(((await run('events', 'list', '--json')) as any[])[0].name).toBe('Town');
  });

  it('unknown event id sets a failing exit code', async () => {
    await run('events', 'rebuild');
    await run('events', 'rename', '999', 'x');
    expect(process.exitCode).toBe(1);
    expect(errs.join(' ')).toMatch(/not found/);
  });

  it('summary --json carries events in order', async () => {
    await run('events', 'rebuild');
    const s = (await run('summary', '--json')) as any;
    expect(s.events).toEqual([
      { id: expect.any(Number), name: 'Town', clips: 2, duration_sec: 20, highlights: 0 },
      { id: expect.any(Number), name: 'Beach', clips: 1, duration_sec: 10, highlights: 0 },
    ]);
    expect(s.clips.total).toBe(3);
  });
});
