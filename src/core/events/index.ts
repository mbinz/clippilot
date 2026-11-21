import path from 'node:path';
import type Database from 'better-sqlite3';
import { ClipRepository } from '../../db/repositories/clip.repository.js';
import { EventRepository, type EventSummary } from '../../db/repositories/event.repository.js';
import type { Clip } from '../../types/clip.js';
import { deriveEvents, rangeDistance, timeGroups, TIME_GAP_MS } from './derive.js';

export { deriveEvents } from './derive.js';
export type { DerivedEvent } from './derive.js';

const ms = (s: string | null): number | null => {
  if (!s) return null;
  const v = Date.parse(s);
  return Number.isNaN(v) ? null : v;
};

const isUnder = (child: string, parent: string) => child !== parent && child.startsWith(parent + path.sep);

function persist(events: EventRepository, projectId: number, derived: ReturnType<typeof deriveEvents>): void {
  for (const d of derived) {
    const e = events.create({ project_id: projectId, name: d.name, source: d.source, folder_path: d.folder_path });
    events.assignClips(e.id, d.clip_ids);
  }
}

/**
 * Give every clip of the project an event. First run derives all events; later runs only place clips
 * with no event and never rename, merge or split existing events.
 */
export function assignEvents(db: Database.Database, projectId: number): void {
  const clipRepo = new ClipRepository(db);
  const events = new EventRepository(db);
  const clips = clipRepo.listByProject(projectId);

  db.transaction(() => {
    if (events.listByProject(projectId).length === 0) {
      persist(events, projectId, deriveEvents(clips));
      events.resort(projectId);
      return;
    }

    const pending = clips.filter((c) => c.event_id === null);
    if (pending.length === 0) return;

    const existing = events.listByProject(projectId);
    const folders = [...new Set(clips.map((c) => path.dirname(c.file_path)))];
    const timeFolders = new Set(clips.filter((c) => c.event_id !== null).map((c) => path.dirname(c.file_path)));
    const rest: Clip[] = [];

    const nearestDated = (t: number, pool: EventSummary[]) => {
      let best: EventSummary | null = null;
      let bestDist = Infinity;
      for (const e of pool) {
        const lo = ms(e.start);
        const hi = ms(e.end);
        if (lo === null || hi === null) continue;
        const d = rangeDistance(t, lo, hi);
        if (d < bestDist) {
          best = e;
          bestDist = d;
        }
      }
      return { event: best, dist: bestDist };
    };

    for (const clip of pending) {
      const folder = path.dirname(clip.file_path);
      const folderEvent = existing.find((e) => e.source === 'folder' && e.folder_path === folder);
      if (folderEvent) {
        events.assignClips(folderEvent.id, [clip.id]);
        continue;
      }
      const t = ms(clip.recorded_at);
      const loose = folders.some((f) => isUnder(f, folder));
      if (loose && t !== null) {
        const { event } = nearestDated(t, existing);
        if (event) {
          events.assignClips(event.id, [clip.id]);
          continue;
        }
      }
      rest.push(clip);
    }

    // Remaining clips: folders already used in time mode extend/open time events; others become folder events.
    const byFolder = new Map<string, Clip[]>();
    for (const c of rest) {
      const f = path.dirname(c.file_path);
      byFolder.set(f, [...(byFolder.get(f) ?? []), c]);
    }
    for (const [folder, group] of byFolder) {
      if (timeFolders.has(folder)) {
        const timeEvents = events.listByProject(projectId).filter((e) => e.source === 'time');
        const fresh: Clip[] = [];
        for (const c of group) {
          const t = ms(c.recorded_at);
          const { event, dist } = t === null ? { event: null, dist: Infinity } : nearestDated(t, timeEvents);
          if (event && dist <= TIME_GAP_MS) events.assignClips(event.id, [c.id]);
          else fresh.push(c);
        }
        const drafts = timeGroups(fresh.map((c) => ({ id: c.id, file_path: c.file_path, ms: ms(c.recorded_at) })));
        persist(events, projectId, drafts.map((d) => ({
          name: d.name, source: 'time' as const, folder_path: null, clip_ids: d.items.map((i) => i.id),
        })));
      } else {
        const e = events.create({
          project_id: projectId, name: path.basename(folder), source: 'folder', folder_path: folder,
        });
        events.assignClips(e.id, group.map((c) => c.id));
      }
    }
    events.resort(projectId);
  })();
}
