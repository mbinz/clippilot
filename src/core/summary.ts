import path from 'node:path';
import type { Clip } from '../types/clip.js';
import { tierRank, type Tier } from './tiers.js';
import type { HighlightRecord } from '../db/repositories/highlight.repository.js';

export interface NameCount {
  name: string;
  clips: number;
}

export interface SummaryHighlight {
  highlight_id: number;
  clip_id: number;
  file_name: string;
  scene_hint: string | null;
  start_sec: number;
  end_sec: number;
  description: string;
  tier: Tier;
  shot: string | null;
  role: string | null;
}

export interface ProjectSummary {
  clips: { total: number; analyzed: number; pending: number; error: number };
  total_duration_sec: number;
  scene_hints: Array<{ scene_hint: string | null; clips: number; duration_sec: number; highlights: number }>;
  places: NameCount[];
  moments: NameCount[];
  best_highlights: SummaryHighlight[];
}

interface Bucket {
  clipIds: Set<number>;
  spellings: Map<string, number>;
  order: string[];
}

class NameCounter {
  private buckets = new Map<string, Bucket>();

  add(clipId: number, raw: unknown): void {
    for (const name of splitTags(raw)) this.addOne(clipId, name);
  }

  private addOne(clipId: number, name: string): void {
    const key = name.toLowerCase();
    let b = this.buckets.get(key);
    if (!b) {
      b = { clipIds: new Set(), spellings: new Map(), order: [] };
      this.buckets.set(key, b);
    }
    if (!b.clipIds.has(clipId)) {
      b.clipIds.add(clipId);
      b.spellings.set(name, (b.spellings.get(name) ?? 0) + 1);
      if (!b.order.includes(name)) b.order.push(name);
    }
  }

  result(): NameCount[] {
    const out: NameCount[] = [];
    for (const b of this.buckets.values()) {
      let best = b.order[0];
      for (const s of b.order) {
        if ((b.spellings.get(s) ?? 0) > (b.spellings.get(best) ?? 0)) best = s;
      }
      out.push({ name: best, clips: b.clipIds.size });
    }
    return out.sort((a, b) => b.clips - a.clips || a.name.localeCompare(b.name));
  }
}

/** Split a comma-separated tag string into trimmed, non-empty names (original case). */
export function splitTags(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  return raw.split(',').map((p) => p.trim()).filter(Boolean);
}

export function parseScenes(json: string | null): Array<{ setting?: unknown; activity?: unknown }> {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((s) => s && typeof s === 'object') : [];
  } catch {
    return [];
  }
}

export function buildProjectSummary(
  clips: Clip[],
  highlights: HighlightRecord[],
  opts: { top: number },
): ProjectSummary {
  const places = new NameCounter();
  const moments = new NameCounter();
  const counts = { total: clips.length, analyzed: 0, pending: 0, error: 0 };
  const hints = new Map<string | null, { clips: number; duration_sec: number; highlights: number }>();
  const byId = new Map<number, Clip>();
  let totalDuration = 0;

  for (const c of clips) {
    byId.set(c.id, c);
    if (c.analysis_status === 'done') counts.analyzed++;
    else if (c.analysis_status === 'error') counts.error++;
    else counts.pending++;
    totalDuration += c.duration_sec;

    const g = hints.get(c.scene_hint) ?? { clips: 0, duration_sec: 0, highlights: 0 };
    g.clips++;
    g.duration_sec += c.duration_sec;
    hints.set(c.scene_hint, g);

    places.add(c.id, c.location);
    for (const s of parseScenes(c.ai_scenes)) {
      places.add(c.id, s.setting);
      moments.add(c.id, s.activity);
    }
  }

  const best: SummaryHighlight[] = [];
  for (const h of highlights) {
    const c = byId.get(h.clip_id);
    if (!c) continue;
    hints.get(c.scene_hint)!.highlights++;
    best.push({
      highlight_id: h.id,
      clip_id: h.clip_id,
      file_name: path.basename(c.file_path),
      scene_hint: c.scene_hint,
      start_sec: h.start_sec,
      end_sec: h.end_sec,
      description: h.description,
      tier: h.tier,
      shot: h.shot,
      role: h.role,
    });
  }
  best.sort((a, b) =>
    tierRank(b.tier) - tierRank(a.tier)
    || (b.end_sec - b.start_sec) - (a.end_sec - a.start_sec)
    || a.clip_id - b.clip_id
    || a.start_sec - b.start_sec);

  const scene_hints = [...hints.entries()]
    .map(([scene_hint, g]) => ({ scene_hint, ...g }))
    .sort((a, b) =>
      a.scene_hint === b.scene_hint ? 0 : a.scene_hint === null ? 1 : b.scene_hint === null ? -1
        : a.scene_hint.localeCompare(b.scene_hint));

  return {
    clips: counts,
    total_duration_sec: totalDuration,
    scene_hints,
    places: places.result(),
    moments: moments.result(),
    best_highlights: best.slice(0, opts.top),
  };
}
