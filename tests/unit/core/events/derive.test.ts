import { describe, it, expect, beforeAll } from 'vitest';
import { deriveEvents } from '../../../../src/core/events/derive.js';

beforeAll(() => {
  process.env.TZ = 'Europe/Lisbon';
});

let nextId = 1;
const clip = (file_path: string, recorded_at: string | null) => ({ id: nextId++, file_path, recorded_at });
// Lisbon is UTC+1 in summer; use explicit Z times.
const at = (hhmm: string, day = '2025-05-27') => `${day}T${hhmm}:00Z`;

describe('deriveEvents', () => {
  it('flat folder -> time groups; 44 min gap stays, 46 min splits', () => {
    nextId = 1;
    const clips = [
      clip('/v/a.mp4', at('07:00')),
      clip('/v/b.mp4', at('07:44')),   // +44 -> same
      clip('/v/c.mp4', at('08:30')),   // +46 -> new
    ];
    const ev = deriveEvents(clips);
    expect(ev).toHaveLength(2);
    expect(ev[0]).toMatchObject({ source: 'time', folder_path: null, clip_ids: [1, 2] });
    expect(ev[1].clip_ids).toEqual([3]);
  });

  it('exactly 45 min does not split', () => {
    nextId = 1;
    const ev = deriveEvents([clip('/v/a.mp4', at('07:00')), clip('/v/b.mp4', at('07:45'))]);
    expect(ev).toHaveLength(1);
  });

  it('names time events with local en-GB format', () => {
    nextId = 1;
    const ev = deriveEvents([clip('/v/a.mp4', at('07:34'))]); // 08:34 Lisbon
    expect(ev[0].name).toBe('Tue 27 May, 08:34');
  });

  it('two leaf folders -> two folder events named by basename', () => {
    nextId = 1;
    const ev = deriveEvents([
      clip('/v/02 Beach/a.mp4', at('10:00')),
      clip('/v/01 Town/b.mp4', at('08:00')),
      clip('/v/01 Town/c.mp4', at('08:05')),
    ]);
    expect(ev.map((e) => e.name)).toEqual(['01 Town', '02 Beach']);
    expect(ev[0]).toMatchObject({ source: 'folder', folder_path: '/v/01 Town', clip_ids: [2, 3] });
  });

  it('loose file joins nearest folder event by time (outside range)', () => {
    nextId = 1;
    const ev = deriveEvents([
      clip('/v/A/a.mp4', at('08:00')),
      clip('/v/A/a2.mp4', at('08:30')),
      clip('/v/B/b.mp4', at('12:00')),
      clip('/v/loose.mp4', at('11:00')), // nearer to B (1h) than A (2.5h)
    ]);
    expect(ev.find((e) => e.name === 'B')!.clip_ids).toContain(4);
    expect(ev.find((e) => e.name === 'A')!.clip_ids).not.toContain(4);
  });

  it('loose file inside a range has distance 0', () => {
    nextId = 1;
    const ev = deriveEvents([
      clip('/v/A/a.mp4', at('08:00')),
      clip('/v/A/a2.mp4', at('12:00')),
      clip('/v/B/b.mp4', at('10:10')),
      clip('/v/loose.mp4', at('10:00')), // inside A's range
    ]);
    expect(ev.find((e) => e.name === 'A')!.clip_ids).toContain(4);
  });

  it('tie goes to the earlier event', () => {
    nextId = 1;
    const ev = deriveEvents([
      clip('/v/A/a.mp4', at('08:00')),
      clip('/v/B/b.mp4', at('10:00')),
      clip('/v/loose.mp4', at('09:00')),
    ]);
    expect(ev.find((e) => e.name === 'A')!.clip_ids).toContain(3);
  });

  it('nested: A has files and A/B is a leaf -> A files are loose and join B', () => {
    nextId = 1;
    const ev = deriveEvents([
      clip('/v/A/x.mp4', at('09:00')),
      clip('/v/A/B/y.mp4', at('09:10')),
    ]);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ name: 'B', source: 'folder', folder_path: '/v/A/B', clip_ids: [2, 1].sort() });
  });

  it('loose files with no dated folder event fall back to time mode', () => {
    nextId = 1;
    const ev = deriveEvents([
      clip('/v/A/x.mp4', at('09:00')),
      clip('/v/A/B/y.mp4', null),
    ]);
    const time = ev.find((e) => e.source === 'time')!;
    expect(time.clip_ids).toEqual([1]);
    expect(ev.find((e) => e.source === 'folder')!.clip_ids).toEqual([2]);
  });

  it('undated clips in time mode go into one Undated event, last', () => {
    nextId = 1;
    const ev = deriveEvents([
      clip('/v/a.mp4', null),
      clip('/v/b.mp4', at('09:00')),
      clip('/v/c.mp4', null),
      clip('/v/d.mp4', at('15:00')),
    ]);
    expect(ev.map((e) => e.name)).toEqual(['Tue 27 May, 10:00', 'Tue 27 May, 16:00', 'Undated']);
    expect(ev[2]).toMatchObject({ source: 'time', folder_path: null, clip_ids: [1, 3] });
  });

  it('orders clips by recorded_at then file_path and events by earliest clip', () => {
    nextId = 1;
    const ev = deriveEvents([
      clip('/v/Z/z.mp4', at('07:00')),
      clip('/v/A/b.mp4', at('09:00')),
      clip('/v/A/a.mp4', at('09:00')),
    ]);
    expect(ev.map((e) => e.name)).toEqual(['Z', 'A']);
    expect(ev[1].clip_ids).toEqual([3, 2]); // a.mp4 before b.mp4
  });

  it('empty input -> no events', () => {
    expect(deriveEvents([])).toEqual([]);
  });
});
