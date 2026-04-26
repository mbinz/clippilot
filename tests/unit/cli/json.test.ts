import { describe, it, expect } from 'vitest';
import { clipToJson } from '../../../src/cli/json.js';
import type { Clip } from '../../../src/types/clip.js';

function baseClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 1,
    project_id: null,
    file_path: '/v/a.mp4',
    proxy_path: null,
    file_hash: 'h',
    file_size: 1,
    duration_sec: 1,
    resolution: null,
    fps: null,
    codec: null,
    recorded_at: null,
    ingested_at: '2026-01-01T00:00:00Z',
    analysis_status: 'pending',
    analysis_error: null,
    location: null,
    manual_tags: null,
    people: null,
    ai_scenes: null,
    ai_summary: null,
    ai_quality_stability: null,
    ai_quality_focus: null,
    ai_quality_exposure: null,
    ai_quality_composition: null,
    ai_quality_audio: null,
    ai_quality_overall: null,
    ai_quality_issues: null,
    ai_editorial_emotional: null,
    ai_editorial_storytelling: null,
    ai_editorial_uniqueness: null,
    ai_editorial_suggested_use: null,
    ai_visual_keywords: null,
    ...overrides,
  };
}

describe('clipToJson', () => {
  it('parses JSON-encoded text fields', () => {
    const json = clipToJson(
      baseClip({
        manual_tags: '["a","b"]',
        people: '["Alice"]',
        ai_visual_keywords: '["beach","kids"]',
        ai_quality_issues: '[]',
        ai_scenes: '[{"t":0}]',
      }),
    );
    expect(json.manual_tags).toEqual(['a', 'b']);
    expect(json.people).toEqual(['Alice']);
    expect(json.ai_visual_keywords).toEqual(['beach', 'kids']);
    expect(json.ai_quality_issues).toEqual([]);
    expect(json.ai_scenes).toEqual([{ t: 0 }]);
  });

  it('returns null for null fields', () => {
    const json = clipToJson(baseClip());
    expect(json.manual_tags).toBeNull();
    expect(json.people).toBeNull();
    expect(json.ai_scenes).toBeNull();
  });

  it('falls back to raw string on parse failure', () => {
    const json = clipToJson(baseClip({ manual_tags: 'not-json' }));
    expect(json.manual_tags).toBe('not-json');
  });

  it('attaches thumbnails when provided', () => {
    const json = clipToJson(baseClip(), ['/t/1.jpg', '/t/2.jpg']);
    expect(json.thumbnails).toEqual(['/t/1.jpg', '/t/2.jpg']);
  });

  it('omits thumbnails key when not provided', () => {
    const json = clipToJson(baseClip());
    expect('thumbnails' in json).toBe(false);
  });
});
