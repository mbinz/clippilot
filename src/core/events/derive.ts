import path from 'node:path';

export interface EventClipInput {
  id: number;
  file_path: string;
  recorded_at: string | null;
}

export type EventSource = 'folder' | 'time';

export interface DerivedEvent {
  name: string;
  source: EventSource;
  folder_path: string | null;
  clip_ids: number[];
}

export const TIME_GAP_MS = 45 * 60 * 1000;
export const UNDATED_NAME = 'Undated';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface EventOptions {
  /** IANA time zone for event names; undefined = system zone. */
  timeZone?: string;
}

/** Time in the given IANA zone (default: system), e.g. "Tue 27 May, 08:34". */
export function formatEventTime(ms: number, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('weekday')} ${get('day')} ${get('month')}, ${get('hour')}:${get('minute')}`;
}

interface Item {
  id: number;
  file_path: string;
  ms: number | null;
}

function toItem(c: EventClipInput): Item {
  const ms = c.recorded_at ? Date.parse(c.recorded_at) : NaN;
  return { id: c.id, file_path: c.file_path, ms: Number.isNaN(ms) ? null : ms };
}

function byTimeThenPath(a: Item, b: Item): number {
  if (a.ms !== null && b.ms !== null && a.ms !== b.ms) return a.ms - b.ms;
  if (a.ms === null && b.ms !== null) return 1;
  if (a.ms !== null && b.ms === null) return -1;
  return a.file_path.localeCompare(b.file_path) || a.id - b.id;
}

function isUnder(child: string, parent: string): boolean {
  return child !== parent && child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);
}

interface Draft {
  name: string;
  source: EventSource;
  folder_path: string | null;
  items: Item[];
  /** Range of the originally assigned (non-loose) dated clips, used for nearest-event matching. */
  min: number | null;
  max: number | null;
}

/** Group clips into time-mode drafts (gap rule), plus one "Undated" draft. */
export function timeGroups(items: Item[], timeZone?: string): Draft[] {
  const dated = items.filter((i) => i.ms !== null).sort(byTimeThenPath);
  const undated = items.filter((i) => i.ms === null).sort(byTimeThenPath);
  const out: Draft[] = [];
  let cur: Item[] = [];
  const flush = () => {
    if (cur.length === 0) return;
    out.push({
      name: formatEventTime(cur[0].ms!, timeZone),
      source: 'time',
      folder_path: null,
      items: cur,
      min: cur[0].ms,
      max: cur[cur.length - 1].ms,
    });
    cur = [];
  };
  for (const it of dated) {
    if (cur.length > 0 && it.ms! - cur[cur.length - 1].ms! > TIME_GAP_MS) flush();
    cur.push(it);
  }
  flush();
  if (undated.length > 0) {
    out.push({ name: UNDATED_NAME, source: 'time', folder_path: null, items: undated, min: null, max: null });
  }
  return out;
}

/** Distance in ms from a point to a [min,max] range (0 when inside). */
export function rangeDistance(ms: number, min: number, max: number): number {
  if (ms < min) return min - ms;
  if (ms > max) return ms - max;
  return 0;
}

function finish(drafts: Draft[]): DerivedEvent[] {
  const key = (d: Draft) => d.items.find((i) => i.ms !== null)
    ? Math.min(...d.items.filter((i) => i.ms !== null).map((i) => i.ms!))
    : Infinity;
  return drafts
    .map((d) => ({ d, k: key(d) }))
    .sort((a, b) => (a.k === b.k ? a.d.name.localeCompare(b.d.name) : a.k < b.k ? -1 : 1))
    .map(({ d }) => ({
      name: d.name,
      source: d.source,
      folder_path: d.folder_path,
      clip_ids: [...d.items].sort(byTimeThenPath).map((i) => i.id),
    }));
}

export function deriveEvents(clips: EventClipInput[], opts: EventOptions = {}): DerivedEvent[] {
  if (clips.length === 0) return [];
  const items = clips.map(toItem);
  const folderOf = (i: Item) => path.dirname(i.file_path);
  const folders = new Set(items.map(folderOf));

  // 1. Flat: everything in one folder.
  if (folders.size === 1) return finish(timeGroups(items, opts.timeZone));

  // 2. Leaf folders become folder events.
  const leaves = [...folders].filter((f) => ![...folders].some((o) => isUnder(o, f)));
  const leafSet = new Set(leaves);
  const drafts = new Map<string, Draft>();
  for (const f of leaves) {
    drafts.set(f, { name: path.basename(f).trim(), source: 'folder', folder_path: f, items: [], min: null, max: null });
  }
  const loose: Item[] = [];
  for (const it of items) {
    const f = folderOf(it);
    if (leafSet.has(f)) {
      const d = drafts.get(f)!;
      d.items.push(it);
      if (it.ms !== null) {
        d.min = d.min === null ? it.ms : Math.min(d.min, it.ms);
        d.max = d.max === null ? it.ms : Math.max(d.max, it.ms);
      }
    } else {
      loose.push(it);
    }
  }

  // 3. Loose files join the nearest dated folder event.
  const dated = [...drafts.values()]
    .filter((d) => d.min !== null)
    .sort((a, b) => a.min! - b.min! || a.name.localeCompare(b.name));
  const unplaced: Item[] = [];
  for (const it of loose) {
    if (it.ms === null || dated.length === 0) {
      unplaced.push(it);
      continue;
    }
    let best = dated[0];
    let bestDist = rangeDistance(it.ms, best.min!, best.max!);
    for (const d of dated.slice(1)) {
      const dist = rangeDistance(it.ms, d.min!, d.max!);
      if (dist < bestDist) {
        best = d;
        bestDist = dist;
      }
    }
    best.items.push(it);
  }

  // 4. Remaining loose files: time mode.
  return finish([...drafts.values(), ...timeGroups(unplaced, opts.timeZone)]);
}
