export interface SampleCandidate {
  clip_id: number;
  file_name: string;
  scene_hint: string | null;
  camera: string;
  reasons: string[];
}

/** Words that mark a clip as showing people. Whole-word, case-insensitive. */
export const PEOPLE_WORDS = ['person', 'people', 'man', 'woman', 'child', 'kid', 'face', 'portrait', 'selfie', 'group'];
const PEOPLE_RE = new RegExp(`\\b(?:${PEOPLE_WORDS.join('|')})\\b`, 'i');

export interface HardnessInput {
  ai_scenes: string | null;
  ai_visual_keywords: string | null;
  ai_quality_stability: number | null;
  duration_sec: number;
}

function peopleText(c: HardnessInput): string {
  const parts: string[] = [];
  if (c.ai_scenes) {
    try {
      const scenes = JSON.parse(c.ai_scenes);
      for (const s of Array.isArray(scenes) ? scenes : []) {
        parts.push(s?.setting, s?.activity, s?.description_en, s?.description_de);
      }
    } catch {
      parts.push(c.ai_scenes);
    }
  }
  if (c.ai_visual_keywords) {
    try {
      const kw = JSON.parse(c.ai_visual_keywords);
      parts.push(...(Array.isArray(kw) ? kw : [c.ai_visual_keywords]));
    } catch {
      parts.push(c.ai_visual_keywords);
    }
  }
  return parts.filter((p): p is string => typeof p === 'string').join('\n');
}

export function detectReasons(clip: HardnessInput, highlightCount: number): string[] {
  const reasons: string[] = [];
  if (PEOPLE_RE.test(peopleText(clip))) reasons.push('people');
  if (clip.ai_quality_stability !== null && clip.ai_quality_stability <= 3) reasons.push('low_stability');
  if (clip.duration_sec >= 20) reasons.push('long');
  if (highlightCount === 0) reasons.push('no_highlights');
  return reasons;
}

export function cameraKey(resolution: string | null, fps: number | null): string {
  return `${resolution}@${fps === null ? fps : Math.round(fps)}`;
}

export function parseClipIds(raw: string): number[] {
  return raw.split(',').map((s) => s.trim()).filter((s) => s !== '').map((s) => {
    if (!/^\d+$/.test(s)) throw new Error(`Invalid clip id "${s}" in --clips`);
    return Number(s);
  });
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function takeWeighted(items: SampleCandidate[], rng: () => number): SampleCandidate {
  const weights = items.map((c) => 1 + c.reasons.length);
  let r = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r < 0) return items.splice(i, 1)[0];
  }
  return items.splice(items.length - 1, 1)[0];
}

/**
 * Round-robin over (scene_hint, camera) groups; within a group weighted random
 * without replacement (weight = 1 + #reasons). Deterministic for a given seed.
 */
export function sampleCalibrationClips(
  candidates: SampleCandidate[],
  opts: { n: number; seed: number },
): SampleCandidate[] {
  const rng = mulberry32(opts.seed);
  const groups = new Map<string, SampleCandidate[]>();
  const sorted = [...candidates].sort((a, b) => a.clip_id - b.clip_id);
  for (const c of sorted) {
    const key = `${c.scene_hint ?? ''}\u0000${c.camera}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(c);
  }
  // seeded Fisher-Yates over groups sorted by key, so the start of the round-robin varies
  const order = [...groups.keys()].sort();
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  const picks: SampleCandidate[] = [];
  while (picks.length < opts.n) {
    let progressed = false;
    for (const key of order) {
      const g = groups.get(key)!;
      if (g.length === 0) continue;
      picks.push(takeWeighted(g, rng));
      progressed = true;
      if (picks.length >= opts.n) break;
    }
    if (!progressed) break;
  }
  return picks;
}
