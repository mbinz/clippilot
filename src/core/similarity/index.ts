import type { Clip } from '../../types/clip.js';
import { UnionFind } from './union-find.js';

export interface RawCluster {
  reason: string;
  members: {
    clip_id: number;
    is_best: boolean;
    similarity_score: number;
  }[];
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function timestampDiffSec(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (isNaN(ta) || isNaN(tb)) return null;
  return Math.abs(ta - tb) / 1000;
}

export function computeSimilarityClusters(clips: Clip[]): RawCluster[] {
  // Only operate on analyzed clips
  const analyzed = clips.filter((c) => c.analysis_status === 'done');
  if (analyzed.length < 2) return [];

  const uf = new UnionFind();
  const reasons = new Map<string, string>();

  for (const clip of analyzed) {
    uf.makeSet(clip.id);
  }

  // --- Check 1: Location + Timestamp proximity (< 10 min) ---
  const byLocation = new Map<string, Clip[]>();
  for (const clip of analyzed) {
    if (!clip.location) continue;
    const key = clip.location.toLowerCase().trim();
    if (!key) continue;
    let group = byLocation.get(key);
    if (!group) {
      group = [];
      byLocation.set(key, group);
    }
    group.push(clip);
  }

  for (const [loc, group] of byLocation) {
    if (group.length < 2) continue;
    group.sort((a, b) => {
      const ta = a.recorded_at ? new Date(a.recorded_at).getTime() : 0;
      const tb = b.recorded_at ? new Date(b.recorded_at).getTime() : 0;
      return ta - tb;
    });
    for (let i = 1; i < group.length; i++) {
      const diffSec = timestampDiffSec(group[i - 1].recorded_at, group[i].recorded_at);
      if (diffSec !== null && diffSec < 600) {
        uf.union(group[i - 1].id, group[i].id);
        const key = pairKey(group[i - 1].id, group[i].id);
        if (!reasons.has(key)) {
          reasons.set(key, `Same location (${loc}), ${Math.round(diffSec / 60)} min apart`);
        }
      }
    }
  }

  // --- Check 2: Keyword overlap >= 60% (Jaccard) ---
  const clipKeywords = new Map<number, Set<string>>();
  for (const clip of analyzed) {
    if (!clip.ai_visual_keywords) continue;
    try {
      const kw = JSON.parse(clip.ai_visual_keywords) as string[];
      if (kw.length > 0) {
        clipKeywords.set(clip.id, new Set(kw.map((k) => k.toLowerCase())));
      }
    } catch { /* skip */ }
  }

  // Build inverted index for efficiency
  const keywordToClips = new Map<string, number[]>();
  for (const [clipId, kws] of clipKeywords) {
    for (const kw of kws) {
      let list = keywordToClips.get(kw);
      if (!list) {
        list = [];
        keywordToClips.set(kw, list);
      }
      list.push(clipId);
    }
  }

  // Only compare pairs that share at least one keyword
  const checkedPairs = new Set<string>();
  for (const clipIds of keywordToClips.values()) {
    for (let i = 0; i < clipIds.length; i++) {
      for (let j = i + 1; j < clipIds.length; j++) {
        const key = pairKey(clipIds[i], clipIds[j]);
        if (checkedPairs.has(key)) continue;
        checkedPairs.add(key);

        const setA = clipKeywords.get(clipIds[i])!;
        const setB = clipKeywords.get(clipIds[j])!;
        let intersectionSize = 0;
        for (const k of setA) {
          if (setB.has(k)) intersectionSize++;
        }
        const unionSize = setA.size + setB.size - intersectionSize;
        const jaccard = unionSize > 0 ? intersectionSize / unionSize : 0;

        if (jaccard >= 0.6) {
          uf.union(clipIds[i], clipIds[j]);
          if (!reasons.has(key)) {
            reasons.set(key, `Similar visual content (${Math.round(jaccard * 100)}% keyword overlap)`);
          }
        }
      }
    }
  }

  // --- Check 3: Same setting + activity ---
  const clipSettingActivity = new Map<number, Set<string>>();
  for (const clip of analyzed) {
    if (!clip.ai_scenes) continue;
    try {
      const scenes = JSON.parse(clip.ai_scenes) as Array<{ setting?: string; activity?: string }>;
      const pairs = new Set<string>();
      for (const s of scenes) {
        if (s.setting && s.activity) {
          pairs.add(`${s.setting.toLowerCase()}|${s.activity.toLowerCase()}`);
        }
      }
      if (pairs.size > 0) {
        clipSettingActivity.set(clip.id, pairs);
      }
    } catch { /* skip */ }
  }

  // Inverted index: setting|activity -> clipIds
  const saToClips = new Map<string, number[]>();
  for (const [clipId, pairs] of clipSettingActivity) {
    for (const pair of pairs) {
      let list = saToClips.get(pair);
      if (!list) {
        list = [];
        saToClips.set(pair, list);
      }
      list.push(clipId);
    }
  }

  for (const [pair, clipIds] of saToClips) {
    if (clipIds.length < 2) continue;
    const [setting, activity] = pair.split('|');
    for (let i = 1; i < clipIds.length; i++) {
      uf.union(clipIds[0], clipIds[i]);
      const key = pairKey(clipIds[0], clipIds[i]);
      if (!reasons.has(key)) {
        reasons.set(key, `Same setting (${setting}) and activity (${activity})`);
      }
    }
  }

  // --- Build clusters ---
  const clusterMap = uf.clusters();
  const clipById = new Map(analyzed.map((c) => [c.id, c]));
  const result: RawCluster[] = [];

  for (const memberIds of clusterMap.values()) {
    if (memberIds.length < 2) continue;

    // Collect all reasons for this cluster
    const clusterReasons = new Set<string>();
    for (let i = 0; i < memberIds.length; i++) {
      for (let j = i + 1; j < memberIds.length; j++) {
        const r = reasons.get(pairKey(memberIds[i], memberIds[j]));
        if (r) clusterReasons.add(r);
      }
    }

    // Sort members by quality descending
    const members = memberIds
      .map((id) => clipById.get(id)!)
      .filter(Boolean)
      .sort((a, b) => (b.ai_quality_overall ?? 0) - (a.ai_quality_overall ?? 0));

    result.push({
      reason: [...clusterReasons].join('; '),
      members: members.map((clip, idx) => ({
        clip_id: clip.id,
        is_best: idx === 0,
        similarity_score: clip.ai_quality_overall ?? 0,
      })),
    });
  }

  return result;
}
