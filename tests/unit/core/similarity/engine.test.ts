import { describe, it, expect } from 'vitest';
import { computeSimilarityClusters } from '../../../../src/core/similarity/index.js';
import type { Clip } from '../../../../src/types/clip.js';

function makeClip(overrides: Partial<Clip> & { id: number }): Clip {
  return {
    project_id: null,
    file_path: `/videos/clip${overrides.id}.mp4`,
    proxy_path: null,
    file_hash: `hash${overrides.id}`,
    file_size: 1000,
    duration_sec: 30,
    resolution: '1920x1080',
    fps: 30,
    codec: 'h264',
    recorded_at: null,
    ingested_at: '2025-01-01T00:00:00Z',
    analysis_status: 'done',
    analysis_error: null,
    location: null,
    manual_tags: null,
    people: null,
    ai_scenes: null,
    ai_summary: null,
    ai_quality_stability: 4,
    ai_quality_focus: 4,
    ai_quality_exposure: 4,
    ai_quality_composition: 3,
    ai_quality_audio: 3,
    ai_quality_overall: 3.6,
    ai_quality_issues: null,
    ai_editorial_emotional: 3,
    ai_editorial_storytelling: 3,
    ai_editorial_uniqueness: 3,
    ai_editorial_suggested_use: 'B-Roll',
    ai_visual_keywords: null,
    ...overrides,
  };
}

describe('computeSimilarityClusters', () => {
  it('returns empty for empty input', () => {
    expect(computeSimilarityClusters([])).toEqual([]);
  });

  it('returns empty for single clip', () => {
    const clips = [makeClip({ id: 1 })];
    expect(computeSimilarityClusters(clips)).toEqual([]);
  });

  it('skips unanalyzed clips', () => {
    const clips = [
      makeClip({ id: 1, analysis_status: 'pending', location: 'Beach' }),
      makeClip({ id: 2, analysis_status: 'pending', location: 'Beach' }),
    ];
    expect(computeSimilarityClusters(clips)).toEqual([]);
  });

  it('clusters by location + timestamp proximity', () => {
    const clips = [
      makeClip({
        id: 1,
        location: 'Beach',
        recorded_at: '2025-06-15T10:00:00Z',
        ai_quality_overall: 4.0,
      }),
      makeClip({
        id: 2,
        location: 'Beach',
        recorded_at: '2025-06-15T10:05:00Z',
        ai_quality_overall: 3.0,
      }),
      makeClip({
        id: 3,
        location: 'Mountain',
        recorded_at: '2025-06-15T10:05:00Z',
      }),
    ];

    const clusters = computeSimilarityClusters(clips);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].members).toHaveLength(2);
    expect(clusters[0].members[0].clip_id).toBe(1); // Higher quality first
    expect(clusters[0].members[0].is_best).toBe(true);
    expect(clusters[0].reason).toContain('Same location');
  });

  it('does not cluster clips > 10 min apart at same location', () => {
    const clips = [
      makeClip({
        id: 1,
        location: 'Beach',
        recorded_at: '2025-06-15T10:00:00Z',
      }),
      makeClip({
        id: 2,
        location: 'Beach',
        recorded_at: '2025-06-15T10:20:00Z',
      }),
    ];

    expect(computeSimilarityClusters(clips)).toEqual([]);
  });

  it('clusters by keyword overlap >= 60%', () => {
    const clips = [
      makeClip({
        id: 1,
        ai_visual_keywords: '["Strand","Kinder","Sand","Meer","Sonne"]',
        ai_quality_overall: 4.5,
      }),
      makeClip({
        id: 2,
        ai_visual_keywords: '["Strand","Kinder","Sand","Meer","Wasser"]',
        ai_quality_overall: 3.0,
      }),
    ];
    // Overlap: Strand, Kinder, Sand, Meer = 4
    // Union: Strand, Kinder, Sand, Meer, Sonne, Wasser = 6
    // Jaccard: 4/6 = 0.667 >= 0.6

    const clusters = computeSimilarityClusters(clips);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].reason).toContain('keyword overlap');
  });

  it('does not cluster by keyword overlap < 60%', () => {
    const clips = [
      makeClip({
        id: 1,
        ai_visual_keywords: '["Strand","Kinder","Sand","Meer","Sonne"]',
      }),
      makeClip({
        id: 2,
        ai_visual_keywords: '["Berg","Wanderung","Wald","Schnee","Gipfel"]',
      }),
    ];
    // No overlap

    expect(computeSimilarityClusters(clips)).toEqual([]);
  });

  it('clusters by same setting + activity', () => {
    const clips = [
      makeClip({
        id: 1,
        ai_scenes: JSON.stringify([{ setting: 'Beach', activity: 'Playing', mood: 'happy' }]),
        ai_quality_overall: 4.0,
      }),
      makeClip({
        id: 2,
        ai_scenes: JSON.stringify([{ setting: 'Beach', activity: 'Playing', mood: 'calm' }]),
        ai_quality_overall: 3.0,
      }),
    ];

    const clusters = computeSimilarityClusters(clips);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].reason).toContain('setting');
    expect(clusters[0].reason).toContain('activity');
  });

  it('merges clusters when clips match on multiple criteria', () => {
    const clips = [
      makeClip({
        id: 1,
        location: 'Beach',
        recorded_at: '2025-06-15T10:00:00Z',
        ai_visual_keywords: '["Strand","Sand","Meer"]',
        ai_quality_overall: 4.0,
      }),
      makeClip({
        id: 2,
        location: 'Beach',
        recorded_at: '2025-06-15T10:03:00Z',
        ai_visual_keywords: '["Strand","Sand","Wasser"]',
        ai_quality_overall: 3.0,
      }),
    ];
    // Matches on location+timestamp AND keyword overlap (2/4 = 0.5... not quite 60%)
    // But location match should create one cluster

    const clusters = computeSimilarityClusters(clips);
    expect(clusters).toHaveLength(1);
  });

  it('sorts cluster members by quality descending', () => {
    const clips = [
      makeClip({
        id: 1,
        location: 'Beach',
        recorded_at: '2025-06-15T10:00:00Z',
        ai_quality_overall: 2.0,
      }),
      makeClip({
        id: 2,
        location: 'Beach',
        recorded_at: '2025-06-15T10:01:00Z',
        ai_quality_overall: 5.0,
      }),
      makeClip({
        id: 3,
        location: 'Beach',
        recorded_at: '2025-06-15T10:02:00Z',
        ai_quality_overall: 3.5,
      }),
    ];

    const clusters = computeSimilarityClusters(clips);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].members[0].clip_id).toBe(2); // Quality 5.0
    expect(clusters[0].members[0].is_best).toBe(true);
    expect(clusters[0].members[1].clip_id).toBe(3); // Quality 3.5
    expect(clusters[0].members[2].clip_id).toBe(1); // Quality 2.0
  });
});
