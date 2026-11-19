import { describe, it, expect } from 'vitest';
import { buildProjectSummary } from '../../../src/core/summary.js';
import type { Clip } from '../../../src/types/clip.js';
import type { HighlightRecord } from '../../../src/db/repositories/highlight.repository.js';

function clip(overrides: Partial<Clip>): Clip {
  return {
    id: 1, project_id: 1, file_path: '/v/a.mp4', proxy_path: null, file_hash: 'h', file_size: 1,
    duration_sec: 10, resolution: null, fps: null, codec: null, recorded_at: null,
    start_timecode: null, nb_frames: null, has_video: 1, has_audio: 1, scene_hint: null,
    ingested_at: '2026-01-01T00:00:00Z', analysis_status: 'done', analysis_error: null,
    location: null, manual_tags: null, people: null, ai_scenes: null, ai_summary: null,
    ai_visual_keywords: null,
    ...overrides,
  };
}

function hl(id: number, clip_id: number, start: number, tier: 'hero' | 'solid' | 'filler', len = 2, desc = 'x'): HighlightRecord {
  return {
    id, clip_id, start_sec: start, end_sec: start + len, description: desc, tier, shot: 'wide', role: 'action',
    issues: '[]', slowmo: 'none', slowmo_reason: '', suggested_speed: 1, created_at: 't',
  };
}

const scenes = (...items: Array<[string, string]>) =>
  JSON.stringify(items.map(([setting, activity]) => ({ setting, activity })));

const clips: Clip[] = [
  clip({ id: 1, file_path: '/v/Delfine/a.mp4', duration_sec: 10, scene_hint: 'Delfine',
    ai_scenes: scenes(['Beach', 'Surfing'], ['Beach', 'Walking']), location: 'Arrifana' }),
  clip({ id: 2, file_path: '/v/Delfine/b.mp4', duration_sec: 20, scene_hint: 'Delfine',
    ai_scenes: scenes(['beach', 'surfing']) }),
  clip({ id: 3, file_path: '/v/Delfine/c.mp4', duration_sec: 5, scene_hint: 'Delfine',
    ai_scenes: scenes(['Beach', 'Dolphins'], ['  ', ''])  }),
  clip({ id: 4, file_path: '/v/Town/d.mp4', duration_sec: 30, scene_hint: 'Aljezur',
    analysis_status: 'pending', ai_scenes: null }),
  clip({ id: 5, file_path: '/v/e.mp4', duration_sec: 1, scene_hint: null, analysis_status: 'error',
    location: 'arrifana' }),
];

const highlights: HighlightRecord[] = [
  hl(1, 1, 5, 'solid'), hl(2, 1, 1, 'hero'), hl(3, 2, 3, 'hero', 3), hl(4, 3, 0, 'filler'), hl(5, 4, 0, 'solid', 4),
];

describe('buildProjectSummary', () => {
  const s = buildProjectSummary(clips, highlights, { top: 10 });

  it('counts clips by status and sums duration', () => {
    expect(s.clips).toEqual({ total: 5, analyzed: 3, pending: 1, error: 1 });
    expect(s.total_duration_sec).toBe(66);
  });

  it('groups scene hints sorted, null last, including unanalyzed clips', () => {
    expect(s.scene_hints).toEqual([
      { scene_hint: 'Aljezur', clips: 1, duration_sec: 30, highlights: 1 },
      { scene_hint: 'Delfine', clips: 3, duration_sec: 35, highlights: 4 },
      { scene_hint: null, clips: 1, duration_sec: 1, highlights: 0 },
    ]);
  });

  it('merges places case-insensitively, counts distinct clips, includes manual location', () => {
    expect(s.places).toEqual([
      { name: 'Beach', clips: 3 },
      { name: 'Arrifana', clips: 2 },
    ]);
  });

  it('merges moments case-insensitively and ignores blank names', () => {
    expect(s.moments).toEqual([
      { name: 'Surfing', clips: 2 },
      { name: 'Dolphins', clips: 1 },
      { name: 'Walking', clips: 1 },
    ]);
  });

  it('orders best highlights by tier, then longer first, then clip_id, start_sec and fills clip info', () => {
    expect(s.best_highlights.map((h) => h.highlight_id)).toEqual([3, 2, 5, 1, 4]);
    expect(s.best_highlights[1]).toEqual({
      highlight_id: 2, clip_id: 1, file_name: 'a.mp4', scene_hint: 'Delfine',
      start_sec: 1, end_sec: 3, description: 'x', tier: 'hero', shot: 'wide', role: 'action',
    });
  });

  it('caps best highlights at top', () => {
    expect(buildProjectSummary(clips, highlights, { top: 2 }).best_highlights).toHaveLength(2);
  });

  it('ignores malformed ai_scenes JSON', () => {
    const r = buildProjectSummary([clip({ id: 9, ai_scenes: 'not json' })], [], { top: 5 });
    expect(r.places).toEqual([]);
  });
});

describe('buildProjectSummary comma-separated tags', () => {
  it('splits comma lists into separate tags, one count per clip', () => {
    const cs = [
      clip({ id: 1, ai_scenes: scenes(['marina, boat', 'sailing, Sailing']) }),
      clip({ id: 2, ai_scenes: scenes(['Marina', 'sailing']) }),
    ];
    const s = buildProjectSummary(cs, [], { top: 5 });
    expect(s.places).toEqual([{ name: 'marina', clips: 2 }, { name: 'boat', clips: 1 }]);
    expect(s.moments).toEqual([{ name: 'sailing', clips: 2 }]);
  });
});
