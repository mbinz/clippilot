import { describe, it, expect } from 'vitest';
import { assignDupGroups, type DupMoment } from '../../../../src/core/similarity/dup-groups.js';

// Local-time ISO strings (no Z) so "same calendar day" is timezone independent.
const T = (hms: string, day = '2026-05-01') => new Date(`${day}T${hms}`).toISOString();

let nextId = 1;
const m = (over: Partial<DupMoment> & { clip_id: number }): DupMoment => ({
  id: nextId++,
  start_sec: 0,
  end_sec: 5,
  recorded_at: null,
  hash: null,
  ...over,
});

describe('assignDupGroups', () => {
  it('groups moments of different clips whose wall-clock ranges overlap by >= 1 s', () => {
    nextId = 1;
    const a = m({ clip_id: 1, recorded_at: T('12:00:00'), start_sec: 0, end_sec: 5 });
    const b = m({ clip_id: 2, recorded_at: T('12:00:04'), start_sec: 0, end_sec: 5 }); // overlap 1 s
    const groups = assignDupGroups([a, b]);
    expect(groups.get(a.id)).toBe(1);
    expect(groups.get(b.id)).toBe(1);
  });

  it('does not group on a 0.5 s overlap', () => {
    nextId = 1;
    const a = m({ clip_id: 1, recorded_at: T('12:00:00'), start_sec: 0, end_sec: 5 });
    const b = m({ clip_id: 2, recorded_at: T('12:00:04.500'), start_sec: 0, end_sec: 5 });
    expect(assignDupGroups([a, b]).size).toBe(0);
  });

  it('uses start/end offsets relative to recorded_at', () => {
    nextId = 1;
    const a = m({ clip_id: 1, recorded_at: T('12:00:00'), start_sec: 10, end_sec: 15 }); // 12:00:10-15
    const b = m({ clip_id: 2, recorded_at: T('12:00:12'), start_sec: 0, end_sec: 5 }); // 12:00:12-17
    expect(assignDupGroups([a, b]).get(a.id)).toBe(1);
  });

  it('never groups moments of the same clip directly', () => {
    nextId = 1;
    const a = m({ clip_id: 1, recorded_at: T('12:00:00'), start_sec: 0, end_sec: 5, hash: 5n });
    const b = m({ clip_id: 1, recorded_at: T('12:00:00'), start_sec: 1, end_sec: 6, hash: 5n });
    expect(assignDupGroups([a, b]).size).toBe(0);
  });

  it('groups by hash within Hamming distance 6, same day', () => {
    nextId = 1;
    const a = m({ clip_id: 1, recorded_at: T('09:00:00'), hash: 0n });
    const b = m({ clip_id: 2, recorded_at: T('18:00:00'), hash: 0b111111n }); // distance 6
    const groups = assignDupGroups([a, b]);
    expect(groups.get(a.id)).toBe(1);
    expect(groups.get(b.id)).toBe(1);
  });

  it('does not group when Hamming distance is 7', () => {
    nextId = 1;
    const a = m({ clip_id: 1, recorded_at: T('09:00:00'), hash: 0n });
    const b = m({ clip_id: 2, recorded_at: T('18:00:00'), hash: 0b1111111n });
    expect(assignDupGroups([a, b]).size).toBe(0);
  });

  it('does not group similar hashes on different days', () => {
    nextId = 1;
    const a = m({ clip_id: 1, recorded_at: T('12:00:00', '2026-05-01'), hash: 0n });
    const b = m({ clip_id: 2, recorded_at: T('12:00:00', '2026-05-02'), hash: 0n });
    expect(assignDupGroups([a, b]).size).toBe(0);
  });

  it('chains transitively A~B~C into one group', () => {
    nextId = 1;
    const a = m({ clip_id: 1, recorded_at: T('12:00:00'), start_sec: 0, end_sec: 5 });
    const b = m({ clip_id: 2, recorded_at: T('12:00:04'), start_sec: 0, end_sec: 5 });
    const c = m({ clip_id: 3, recorded_at: T('12:00:08'), start_sec: 0, end_sec: 5 });
    const groups = assignDupGroups([a, b, c]);
    expect(new Set([groups.get(a.id), groups.get(b.id), groups.get(c.id)])).toEqual(new Set([1]));
  });

  it('numbers groups 1..n by lowest moment id; singletons get no group', () => {
    nextId = 1;
    const a = m({ clip_id: 1, recorded_at: T('08:00:00') }); // id 1, alone
    const b = m({ clip_id: 2, recorded_at: T('12:00:00') }); // id 2, pairs with d
    const c = m({ clip_id: 3, recorded_at: T('10:00:00') }); // id 3, pairs with e
    const d = m({ clip_id: 4, recorded_at: T('12:00:01') }); // id 4
    const e = m({ clip_id: 5, recorded_at: T('10:00:02') }); // id 5
    const groups = assignDupGroups([e, d, c, b, a]);
    expect(groups.has(a.id)).toBe(false);
    expect(groups.get(b.id)).toBe(1);
    expect(groups.get(d.id)).toBe(1);
    expect(groups.get(c.id)).toBe(2);
    expect(groups.get(e.id)).toBe(2);
  });

  it('missing recorded_at or hash gives no group', () => {
    nextId = 1;
    const a = m({ clip_id: 1, recorded_at: null, hash: 0n });
    const b = m({ clip_id: 2, recorded_at: T('12:00:00'), hash: 0n });
    const c = m({ clip_id: 3, recorded_at: T('14:00:00'), hash: null });
    expect(assignDupGroups([a, b, c]).size).toBe(0);
  });
});

import Database from 'better-sqlite3';
import { runMigrations } from '../../../../src/db/migrations/runner.js';
import { ClipRepository } from '../../../../src/db/repositories/clip.repository.js';
import { ProjectRepository } from '../../../../src/db/repositories/project.repository.js';
import { HighlightRepository } from '../../../../src/db/repositories/highlight.repository.js';
import { ThumbnailRepository } from '../../../../src/db/repositories/thumbnail.repository.js';
import { recomputeDupGroups } from '../../../../src/core/similarity/dup-groups.js';

describe('recomputeDupGroups', () => {
  const mk = (over: object) => ({
    project_id: null, file_path: '/x', proxy_path: null, file_hash: 'h', file_size: 1, duration_sec: 30,
    resolution: null, fps: 30, nb_frames: 900, has_video: 1, has_audio: 1, codec: 'h264',
    recorded_at: null, start_timecode: null, location: null, manual_tags: null, people: null, ...over,
  });

  it('hashes the thumbnail nearest the moment midpoint and persists groups', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    const clips = new ClipRepository(db);
    const hl = new HighlightRepository(db);
    const th = new ThumbnailRepository(db);
    const p = new ProjectRepository(db).findOrCreate('p');
    const c1 = clips.insert(mk({ project_id: p.id, file_path: '/a', file_hash: 'a', recorded_at: T('09:00:00') }) as any);
    const c2 = clips.insert(mk({ project_id: p.id, file_path: '/b', file_hash: 'b', recorded_at: T('15:00:00') }) as any);
    const c3 = clips.insert(mk({ project_id: p.id, file_path: '/c', file_hash: 'c', recorded_at: T('16:00:00') }) as any); // no thumbs
    for (const c of [c1, c2]) {
      th.insertMany([
        { clip_id: c.id, file_path: `/t/${c.id}-0.jpg`, timestamp_sec: 0 },
        { clip_id: c.id, file_path: `/t/${c.id}-10.jpg`, timestamp_sec: 10 },
      ]);
    }
    const mid = { start_sec: 9, end_sec: 11, description: 'x', tier: 'solid' as const }; // midpoint 10
    for (const c of [c1, c2, c3]) hl.replaceForClip(c.id, [mid]);

    const seen: string[] = [];
    const hashFn = async (path: string) => { seen.push(path); return path.includes('-10') ? 0n : 2n ** 40n - 1n; };
    await recomputeDupGroups(p.id, { clips, highlights: hl, thumbnails: th }, hashFn);

    expect(seen.sort()).toEqual([`/t/${c1.id}-10.jpg`, `/t/${c2.id}-10.jpg`]);
    expect(hl.findByClip(c1.id)[0].dup_group).toBe(1);
    expect(hl.findByClip(c2.id)[0].dup_group).toBe(1);
    expect(hl.findByClip(c3.id)[0].dup_group).toBeNull();
  });

  it('a hash failure for one thumbnail gives that moment no hash instead of throwing', async () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const clips = new ClipRepository(db);
    const hl = new HighlightRepository(db);
    const th = new ThumbnailRepository(db);
    const p = new ProjectRepository(db).findOrCreate('p');
    const c1 = clips.insert(mk({ project_id: p.id, file_path: '/a', file_hash: 'a', recorded_at: T('09:00:00') }) as any);
    th.insert({ clip_id: c1.id, file_path: '/missing.jpg', timestamp_sec: 0 });
    hl.replaceForClip(c1.id, [{ start_sec: 0, end_sec: 4, description: 'x', tier: 'solid' }]);
    await expect(recomputeDupGroups(p.id, { clips, highlights: hl, thumbnails: th }, async () => { throw new Error('nope'); })).resolves.toBeUndefined();
  });
});
