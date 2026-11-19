import { describe, it, expect } from 'vitest';
import { buildReviewData } from '../../../../src/core/review/review-data.js';
import type { Clip } from '../../../../src/types/clip.js';
import type { HighlightRecord } from '../../../../src/db/repositories/highlight.repository.js';

function clip(overrides: Partial<Clip>): Clip {
  return {
    id: 1, project_id: 1, file_path: '/v/a.mp4', proxy_path: null, file_hash: 'h', file_size: 1,
    duration_sec: 10, resolution: null, fps: null, codec: null, recorded_at: null,
    start_timecode: null, nb_frames: null, has_video: 1, has_audio: 1, scene_hint: null,
    ingested_at: '2026-01-01T00:00:00Z', analysis_status: 'done', analysis_error: null,
    location: null, manual_tags: null, people: null, ai_scenes: null, ai_summary: null,
    ai_quality_stability: null, ai_quality_focus: null, ai_quality_exposure: null,
    ai_quality_composition: null, ai_quality_audio: null, ai_quality_overall: null,
    ai_quality_issues: null, ai_editorial_emotional: null, ai_editorial_storytelling: null,
    ai_editorial_uniqueness: null, ai_editorial_suggested_use: null, ai_visual_keywords: null,
    ...overrides,
  };
}

function hl(id: number, clip_id: number, start: number): HighlightRecord {
  return { id, clip_id, start_sec: start, end_sec: start + 2, description: `d${id}`, quality: 4, created_at: 't' };
}

const build = (clips: Clip[], highlights: HighlightRecord[] = []) =>
  buildReviewData(clips, highlights, { project: 'P', generated_at: '2026-02-02T00:00:00Z' });

describe('buildReviewData', () => {
  it('includes analyzed clips without highlights, skips unanalyzed ones', () => {
    const data = build([
      clip({ id: 1 }),
      clip({ id: 2, analysis_status: 'pending' }),
      clip({ id: 3, analysis_status: 'error' }),
    ]);
    expect(data.clips.map((c) => c.clip_id)).toEqual([1]);
    expect(data.clips[0].highlights).toEqual([]);
    expect(data.project).toBe('P');
    expect(data.generated_at).toBe('2026-02-02T00:00:00Z');
  });

  it('sorts by scene_hint then file_name, null hints last', () => {
    const data = build([
      clip({ id: 1, file_path: '/v/z.mp4', scene_hint: 'A' }),
      clip({ id: 2, file_path: '/v/b.mp4', scene_hint: null }),
      clip({ id: 3, file_path: '/v/a.mp4', scene_hint: 'B' }),
      clip({ id: 4, file_path: '/v/a.mp4', scene_hint: 'A' }),
    ]);
    expect(data.clips.map((c) => c.clip_id)).toEqual([4, 1, 3, 2]);
  });

  it('orders highlights by start_sec and maps fields', () => {
    const data = build([clip({ id: 1, ai_summary: 'sum' })], [hl(10, 1, 8), hl(11, 1, 2)]);
    const c = data.clips[0];
    expect(c.highlights.map((h) => h.highlight_id)).toEqual([11, 10]);
    expect(c.highlights[0]).toEqual({ highlight_id: 11, start_sec: 2, end_sec: 4, description: 'd11', quality: 4 });
    expect(c.ai_summary).toBe('sum');
    expect(c.file_name).toBe('a.mp4');
    expect(c.file_path).toBe('/v/a.mp4');
  });

  it('builds a percent-encoded file URL for the proxy, null when absent', () => {
    const data = build([
      clip({ id: 1, proxy_path: '/x/Src /a b.mp4' }),
      clip({ id: 2, file_path: '/v/b.mp4', proxy_path: null }),
    ]);
    expect(data.clips[0].proxy_url).toBe('file:///x/Src%20/a%20b.mp4');
    expect(data.clips[1].proxy_url).toBeNull();
  });

  it('splits, lowercases and dedupes places and moments', () => {
    const scenes = JSON.stringify([
      { setting: 'marina, boat', activity: 'Sailing' },
      { setting: 'Marina', activity: 'sailing, Fishing' },
    ]);
    const c = build([clip({ ai_scenes: scenes })]).clips[0];
    expect(c.places).toEqual(['marina', 'boat']);
    expect(c.moments).toEqual(['sailing', 'fishing']);
  });

  it('maps all scores, suggested use and parsed quality issues', () => {
    const c = build([clip({
      ai_quality_stability: 4, ai_quality_focus: 5, ai_quality_exposure: 3, ai_quality_composition: 2,
      ai_quality_audio: 1, ai_quality_overall: 7, ai_editorial_emotional: 6, ai_editorial_storytelling: 5,
      ai_editorial_uniqueness: 4, ai_editorial_suggested_use: 'b-roll',
      ai_quality_issues: '["shaky","overexposed"]',
    })]).clips[0];
    expect(c.scores).toEqual({
      quality: { stability: 4, focus: 5, exposure: 3, composition: 2, audio: 1, overall: 7 },
      editorial: { emotional: 6, storytelling: 5, uniqueness: 4 },
      quality_issues: ['shaky', 'overexposed'],
      suggested_use: 'b-roll',
    });
  });

  it('keeps null scores null and handles issues as plain string or null', () => {
    const plain = build([clip({ ai_quality_issues: 'slightly shaky' })]).clips[0].scores;
    expect(plain.quality_issues).toEqual(['slightly shaky']);
    const none = build([clip({})]).clips[0].scores;
    expect(none.quality_issues).toEqual([]);
    expect(none.suggested_use).toBeNull();
    expect(none.quality).toEqual({ stability: null, focus: null, exposure: null, composition: null, audio: null, overall: null });
    expect(none.editorial).toEqual({ emotional: null, storytelling: null, uniqueness: null });
  });

  it('restricts to the given clip ids when provided', () => {
    const data = buildReviewData(
      [clip({ id: 1 }), clip({ id: 2, file_path: '/v/b.mp4' }), clip({ id: 3, file_path: '/v/c.mp4' })],
      [],
      { project: 'P', generated_at: 'x' },
      [3, 1],
    );
    expect(data.clips.map((c) => c.clip_id).sort()).toEqual([1, 3]);
  });
});
