import { describe, it, expect } from 'vitest';
import {
  sampleCalibrationClips, detectReasons, parseClipIds, type SampleCandidate,
} from '../../../../src/core/calibration/sampling.js';

const cand = (clip_id: number, scene_hint: string | null, camera: string, reasons: string[] = []): SampleCandidate => ({
  clip_id, file_name: `c${clip_id}.mp4`, scene_hint, camera, reasons,
});

const base = {
  ai_scenes: null as string | null, ai_visual_keywords: null as string | null,
  ai_quality_stability: 5 as number | null, duration_sec: 10,
};

describe('detectReasons', () => {
  it('flags people from scene description, case-insensitive', () => {
    const scenes = JSON.stringify([{ description_en: 'A Woman walks on the pier', setting: 'pier', activity: 'walking', subjects: [] }]);
    expect(detectReasons({ ...base, ai_scenes: scenes }, 2)).toEqual(['people']);
  });

  it('flags people from visual keywords and from setting/activity', () => {
    expect(detectReasons({ ...base, ai_visual_keywords: JSON.stringify(['sea', 'selfie']) }, 1)).toEqual(['people']);
    const scenes = JSON.stringify([{ description_en: 'x', setting: 'beach', activity: 'group dinner' }]);
    expect(detectReasons({ ...base, ai_scenes: scenes }, 1)).toEqual(['people']);
  });

  it('matches whole words only: "manhattan" is not "man"', () => {
    const scenes = JSON.stringify([{ description_en: 'Manhattan skyline at dusk', setting: 'city', activity: 'sightseeing' }]);
    expect(detectReasons({ ...base, ai_scenes: scenes, ai_visual_keywords: JSON.stringify(['skyline', 'manhattan']) }, 1)).toEqual([]);
  });

  it('flags low_stability at <= 3, not at 4 or null', () => {
    expect(detectReasons({ ...base, ai_quality_stability: 3 }, 1)).toEqual(['low_stability']);
    expect(detectReasons({ ...base, ai_quality_stability: 4 }, 1)).toEqual([]);
    expect(detectReasons({ ...base, ai_quality_stability: null }, 1)).toEqual([]);
  });

  it('flags long at >= 20 s and no_highlights at 0', () => {
    expect(detectReasons({ ...base, duration_sec: 20 }, 1)).toEqual(['long']);
    expect(detectReasons({ ...base, duration_sec: 19.9 }, 1)).toEqual([]);
    expect(detectReasons(base, 0)).toEqual(['no_highlights']);
  });

  it('combines reasons in a stable order', () => {
    const scenes = JSON.stringify([{ description_en: 'child laughing', setting: 'a', activity: 'b' }]);
    expect(detectReasons({ ai_scenes: scenes, ai_visual_keywords: null, ai_quality_stability: 2, duration_sec: 30 }, 0))
      .toEqual(['people', 'low_stability', 'long', 'no_highlights']);
  });
});

describe('sampleCalibrationClips', () => {
  const pool = [
    cand(1, 'boat', '1920x1080@30'), cand(2, 'boat', '1920x1080@30'), cand(3, 'boat', '1920x1080@30'),
    cand(4, 'beach', '3840x2160@60'), cand(5, 'beach', '3840x2160@60'),
    cand(6, 'town', '1920x1080@30'), cand(7, 'town', '1920x1080@30'),
    cand(8, 'boat', '1920x1080@30'), cand(9, 'beach', '3840x2160@60'), cand(10, 'town', '1920x1080@30'),
  ];

  it('is deterministic for the same seed and input', () => {
    const a = sampleCalibrationClips(pool, { n: 5, seed: 42 });
    const b = sampleCalibrationClips(pool, { n: 5, seed: 42 });
    expect(a.map((c) => c.clip_id)).toEqual(b.map((c) => c.clip_id));
  });

  it('different seeds give different picks on this input', () => {
    const one = sampleCalibrationClips(pool, { n: 5, seed: 1 }).map((c) => c.clip_id);
    const two = sampleCalibrationClips(pool, { n: 5, seed: 2 }).map((c) => c.clip_id);
    expect(one).not.toEqual(two);
  });

  it('stratifies: 3 groups and n=3 yields one clip from each group', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const picks = sampleCalibrationClips(pool, { n: 3, seed });
      expect(new Set(picks.map((c) => c.scene_hint)).size).toBe(3);
    }
  });

  it('treats scene_hint and camera together as the group key', () => {
    const p = [cand(1, 'boat', 'A@30'), cand(2, 'boat', 'A@30'), cand(3, 'boat', 'B@30'), cand(4, 'boat', 'B@30')];
    for (const seed of [1, 2, 3]) {
      const picks = sampleCalibrationClips(p, { n: 2, seed });
      expect(new Set(picks.map((c) => c.camera)).size).toBe(2);
    }
  });

  it('returns everything when the pool is smaller than n, without duplicates', () => {
    const picks = sampleCalibrationClips(pool.slice(0, 3), { n: 8, seed: 7 });
    expect(picks.map((c) => c.clip_id).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('weights hard clips: a clip with 4 reasons is picked far more often than a plain one', () => {
    const p = [cand(1, 'x', 'c', ['people', 'low_stability', 'long', 'no_highlights']), cand(2, 'x', 'c')];
    let hard = 0;
    for (let seed = 0; seed < 200; seed++) if (sampleCalibrationClips(p, { n: 1, seed })[0].clip_id === 1) hard++;
    // expected 5/6 = ~167 of 200
    expect(hard).toBeGreaterThan(140);
    expect(hard).toBeLessThan(195);
  });
});

describe('parseClipIds', () => {
  it('parses a comma list, tolerating spaces', () => {
    expect(parseClipIds('3, 5,12')).toEqual([3, 5, 12]);
  });
  it('rejects non-numeric entries', () => {
    expect(() => parseClipIds('3,abc')).toThrow(/abc/);
  });
});
