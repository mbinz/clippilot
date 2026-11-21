import type Database from 'better-sqlite3';
import type { Clip } from '../../types/clip.js';

export type EventSourceKind = 'folder' | 'time';

export interface EventRecord {
  id: number;
  project_id: number;
  name: string;
  source: EventSourceKind;
  folder_path: string | null;
  sort_order: number;
  created_at: string;
}

export interface EventSummary extends EventRecord {
  clip_count: number;
  start: string | null;
  end: string | null;
}

export interface CreateEvent {
  project_id: number;
  name: string;
  source: EventSourceKind;
  folder_path: string | null;
  sort_order?: number;
}

/** Event order of clips: recording time (undated last), then path. */
const CLIP_ORDER = 'ORDER BY (recorded_at IS NULL), recorded_at ASC, file_path ASC, id ASC';

export class EventRepository {
  constructor(private db: Database.Database) {}

  findById(id: number): EventRecord | null {
    return (this.db.prepare('SELECT * FROM events WHERE id = ?').get(id) as EventRecord) ?? null;
  }

  listByProject(projectId: number): EventSummary[] {
    return this.db.prepare(`
      SELECT e.*, COUNT(c.id) AS clip_count, MIN(c.recorded_at) AS start, MAX(c.recorded_at) AS end
      FROM events e LEFT JOIN clips c ON c.event_id = e.id
      WHERE e.project_id = ?
      GROUP BY e.id
      ORDER BY e.sort_order ASC, e.id ASC
    `).all(projectId) as EventSummary[];
  }

  create(input: CreateEvent): EventRecord {
    const r = this.db.prepare(
      'INSERT INTO events (project_id, name, source, folder_path, sort_order) VALUES (?, ?, ?, ?, ?)',
    ).run(input.project_id, input.name, input.source, input.folder_path, input.sort_order ?? 0);
    return this.findById(Number(r.lastInsertRowid))!;
  }

  rename(id: number, name: string): void {
    this.db.prepare('UPDATE events SET name = ? WHERE id = ?').run(name, id);
  }

  assignClips(eventId: number, clipIds: number[]): void {
    const stmt = this.db.prepare('UPDATE clips SET event_id = ? WHERE id = ?');
    this.db.transaction(() => {
      for (const id of clipIds) stmt.run(eventId, id);
    })();
  }

  clipsOf(eventId: number): Clip[] {
    return this.db.prepare(`SELECT * FROM clips WHERE event_id = ? ${CLIP_ORDER}`).all(eventId) as Clip[];
  }

  /** Move all clips of `otherIds` (same project) into the target and delete those events. */
  merge(targetId: number, otherIds: number[]): void {
    const target = this.findById(targetId);
    if (!target) throw new Error(`Event ${targetId} not found`);
    this.db.transaction(() => {
      for (const id of otherIds) {
        if (id === targetId) continue;
        const other = this.findById(id);
        if (!other) throw new Error(`Event ${id} not found`);
        if (other.project_id !== target.project_id) throw new Error(`Event ${id} belongs to another project`);
        this.db.prepare('UPDATE clips SET event_id = ? WHERE event_id = ?').run(targetId, id);
        this.db.prepare('DELETE FROM events WHERE id = ?').run(id);
      }
      this.resort(target.project_id);
    })();
  }

  /** The clip and all later ones (event order) move to a new event "<name> (2)". */
  split(eventId: number, atClipId: number): EventRecord {
    const event = this.findById(eventId);
    if (!event) throw new Error(`Event ${eventId} not found`);
    const ordered = this.clipsOf(eventId);
    const idx = ordered.findIndex((c) => c.id === atClipId);
    if (idx < 0) throw new Error(`Clip ${atClipId} is not in event ${eventId}`);
    if (idx === 0) throw new Error('Cannot split at the first clip of an event');
    return this.db.transaction(() => {
      const created = this.create({
        project_id: event.project_id,
        name: `${event.name} (2)`,
        source: event.source,
        folder_path: null,
        sort_order: event.sort_order + 1,
      });
      this.assignClips(created.id, ordered.slice(idx).map((c) => c.id));
      this.resort(event.project_id);
      return this.findById(created.id)!;
    })();
  }

  /** sort_order = rank by earliest recorded_at (undated last, then by id). */
  resort(projectId: number): void {
    const rows = this.db.prepare(`
      SELECT e.id, MIN(c.recorded_at) AS start
      FROM events e LEFT JOIN clips c ON c.event_id = e.id
      WHERE e.project_id = ? GROUP BY e.id
    `).all(projectId) as { id: number; start: string | null }[];
    const ms = (s: string | null) => (s === null || Number.isNaN(Date.parse(s)) ? Infinity : Date.parse(s));
    rows.sort((a, b) => (ms(a.start) === ms(b.start) ? a.id - b.id : ms(a.start) < ms(b.start) ? -1 : 1));
    const stmt = this.db.prepare('UPDATE events SET sort_order = ? WHERE id = ?');
    this.db.transaction(() => rows.forEach((r, i) => stmt.run(i, r.id)))();
  }

  deleteByProject(projectId: number): void {
    this.db.prepare('DELETE FROM events WHERE project_id = ?').run(projectId);
  }
}
