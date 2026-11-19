import { describe, it, expect } from 'vitest';
import { computeSimilarityClusters } from '../../../../src/core/similarity/index.js';
import type { MomentInfo } from '../../../../src/core/similarity/index.js';
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
    ai_visual_keywords: null,
    ...overrides,
  };
}

const mom = (tier: string, len = 2): MomentInfo => ({ tier, start_sec: 0, end_sec: len });

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
      }),
      makeClip({
        id: 2,
        location: 'Beach',
        recorded_at: '2025-06-15T10:05:00Z',
      }),
      makeClip({
        id: 3,
        location: 'Mountain',
        recorded_at: '2025-06-15T10:05:00Z',
      }),
    ];

    const clusters = computeSimilarityClusters(clips, new Map([[1, [mom('hero')]], [2, [mom('filler')]]]));
    expect(clusters).toHaveLength(1);
    expect(clusters[0].members).toHaveLength(2);
    expect(clusters[0].members[0].clip_id).toBe(1); // Better moment tier first
    expect(clusters[0].members.map((m) => m.similarity_score)).toEqual([3, 1]);
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
      }),
      makeClip({
        id: 2,
        ai_visual_keywords: '["Strand","Kinder","Sand","Meer","Wasser"]',
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
      }),
      makeClip({
        id: 2,
        ai_scenes: JSON.stringify([{ setting: 'Beach', activity: 'Playing', mood: 'calm' }]),
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
      }),
      makeClip({
        id: 2,
        location: 'Beach',
        recorded_at: '2025-06-15T10:03:00Z',
        ai_visual_keywords: '["Strand","Sand","Wasser"]',
      }),
    ];
    // Matches on location+timestamp AND keyword overlap (2/4 = 0.5... not quite 60%)
    // But location match should create one cluster

    const clusters = computeSimilarityClusters(clips);
    expect(clusters).toHaveLength(1);
  });

  it('sorts cluster members by best moment tier, then moment duration, then clip id', () => {
    const at = (id: number, min: number) => makeClip({
      id, location: 'Beach', recorded_at: `2025-06-15T10:0${min}:00Z`,
    });
    const clips = [at(1, 0), at(2, 1), at(3, 2), at(4, 3), at(5, 4)];
    const moments = new Map<number, MomentInfo[]>([
      [1, [mom('filler', 9)]],
      [2, [mom('hero', 2), mom('filler', 9)]],
      [3, [mom('solid', 3)]],
      [4, [mom('solid', 5)]],
      // clip 5 has no moments
    ]);

    const clusters = computeSimilarityClusters(clips, moments);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].members.map((m) => m.clip_id)).toEqual([2, 4, 3, 1, 5]);
    expect(clusters[0].members[0].is_best).toBe(true);
    expect(clusters[0].members.map((m) => m.similarity_score)).toEqual([3, 2, 2, 1, 0]);
  });

  it('falls back to clip id order when no moments are known', () => {
    const clips = [
      makeClip({ id: 2, location: 'Beach', recorded_at: '2025-06-15T10:01:00Z' }),
      makeClip({ id: 1, location: 'Beach', recorded_at: '2025-06-15T10:00:00Z' }),
    ];
    expect(computeSimilarityClusters(clips)[0].members.map((m) => m.clip_id)).toEqual([1, 2]);
  });
});
