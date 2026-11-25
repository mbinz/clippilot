import { describe, it, expect } from 'vitest';
import { clipToJson, highlightsToJson } from '../../../src/cli/json.js';
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
    ai_visual_keywords: null,
    ...overrides,
  };
}

describe('clipToJson transcript', () => {
  it('never carries transcript_text, only an optional excerpt', () => {
    const clip = baseClip({ transcript_text: 'x'.repeat(500) } as Partial<Clip>);
    expect('transcript_text' in clipToJson(clip)).toBe(false);
    expect((clipToJson(clip) as any).transcript_excerpt).toBeUndefined();
    expect((clipToJson(clip, undefined, undefined, { excerpt: true }) as any).transcript_excerpt).toBe('x'.repeat(200));
  });
});

describe('clipToJson', () => {
  it('parses JSON-encoded text fields', () => {
    const json = clipToJson(
      baseClip({
        manual_tags: '["a","b"]',
        people: '["Alice"]',
        ai_visual_keywords: '["beach","kids"]',
        ai_scenes: '[{"t":0}]',
      }),
    );
    expect(json.manual_tags).toEqual(['a', 'b']);
    expect(json.people).toEqual(['Alice']);
    expect(json.ai_visual_keywords).toEqual(['beach', 'kids']);
    expect('ai_quality_overall' in json).toBe(false);
    expect('ai_editorial_suggested_use' in json).toBe(false);
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

  it('includes highlights when provided', () => {
    const hl = [{ id: 1, start_sec: 1, end_sec: 2.5, description: 'Wave', tier: 'hero', shot: 'wide', role: 'action', issues: [], slowmo: 'none', slowmo_reason: '', suggested_speed: 1, audio_keep: false, audio_type: 'noise' }];
    const json = clipToJson(baseClip(), undefined, hl);
    expect(json.highlights).toEqual(hl);
  });

  it('omits highlights key when not provided', () => {
    const json = clipToJson(baseClip());
    expect('highlights' in json).toBe(false);
  });

  it('highlightsToJson passes slowmo fields through and exposes tier/shot/role/issues (issues parsed to an array)', () => {
    const rec = { id: 3, start_sec: 1, end_sec: 2, description: 'd', tier: 'hero', shot: 'close', role: 'reaction', issues: '["obstructed"]', slowmo: 'light', slowmo_reason: 'waves', suggested_speed: 0.5, audio_keep: 1, audio_type: 'ambient', clip_id: 9, created_at: 'x' };
    expect(highlightsToJson([rec])).toEqual([
      { id: 3, start_sec: 1, end_sec: 2, description: 'd', tier: 'hero', shot: 'close', role: 'reaction', issues: ['obstructed'], slowmo: 'light', slowmo_reason: 'waves', suggested_speed: 0.5, audio_keep: true, audio_type: 'ambient', dup_group: null },
    ]);
  });

  it('highlightsToJson emits dup_group', () => {
    const rec = { id: 3, start_sec: 1, end_sec: 2, description: 'd', tier: 'hero', shot: null, role: null, issues: '[]', slowmo: 'none', slowmo_reason: '', suggested_speed: 1, audio_keep: 0, audio_type: 'noise', dup_group: 4 };
    expect(highlightsToJson([rec])[0].dup_group).toBe(4);
  });
});
