import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../../src/db/migrations/runner.js';
import { ClipRepository } from '../../../../src/db/repositories/clip.repository.js';
import { HighlightRepository } from '../../../../src/db/repositories/highlight.repository.js';
import { lookFrameTimes } from '../../../../src/core/look/frames.js';
import { averageNormalize } from '../../../../src/core/look/vector.js';
import { lookState } from '../../../../src/core/look/stale.js';
import { fillLookFingerprints, type LookEmbedder } from '../../../../src/core/look/index.js';
import { analyzeAware } from '../../../../src/core/analyze/pipeline.js';
import { DEFAULT_CONFIG } from '../../../../src/core/config/defaults.js';
import { TranscriptRepository } from '../../../../src/db/repositories/transcript.repository.js';
import { MotionRepository } from '../../../../src/db/repositories/motion.repository.js';

describe('lookFrameTimes', () => {
  it('20 / 50 / 80 % of the moment range', () => {
    const t = lookFrameTimes(10, 20);
    expect(t[0]).toBeCloseTo(12); expect(t[1]).toBeCloseTo(15); expect(t[2]).toBeCloseTo(18);
    expect(t).toHaveLength(3);
  });
});

describe('averageNormalize', () => {
  it('averages the vectors and scales to unit length', () => {
    const v = averageNormalize([new Float32Array([1, 0]), new Float32Array([0, 1])]);
    expect(v[0]).toBeCloseTo(Math.SQRT1_2); expect(v[1]).toBeCloseTo(Math.SQRT1_2);
    expect(Math.hypot(...v)).toBeCloseTo(1);
  });
  it('a zero average stays zero (no NaN)', () => {
    const v = averageNormalize([new Float32Array([1, 0]), new Float32Array([-1, 0])]);
    expect([...v]).toEqual([0, 0]);
  });
});

describe('lookState (stale rule)', () => {
  const base = { start_sec: 2, end_sec: 8, look_vec: Buffer.alloc(4), look_start_sec: 2, look_end_sec: 8 };
  it('missing without vector', () => { expect(lookState({ ...base, look_vec: null })).toBe('missing'); });
  it('fresh when the range equals the fingerprint range', () => { expect(lookState(base)).toBe('fresh'); });
  it('stale when start or end moved', () => {
    expect(lookState({ ...base, start_sec: 3 })).toBe('stale');
    expect(lookState({ ...base, end_sec: 7.5 })).toBe('stale');
  });
});

function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  const clips = new ClipRepository(db), highlights = new HighlightRepository(db);
  const clip = clips.insert({
    project_id: null, file_path: '/v/a.mp4', proxy_path: '/v/a.proxy.mp4', file_hash: 'h', file_size: 1, duration_sec: 40, resolution: null,
    fps: 25, nb_frames: null, has_video: 1, has_audio: 1, codec: null, recorded_at: null, start_timecode: null,
    location: null, manual_tags: null, people: null,
  });
  clips.updateAnalysisStatus(clip.id, 'done');
  return { db, clips, highlights, clip };
}
const fake: LookEmbedder & { calls: number } = {
  model: 'fake', calls: 0,
  async embed(images: Buffer[]) { this.calls += images.length; return images.map(() => new Float32Array([3, 4])); },
};
const grab = async () => Buffer.from('jpg');

describe('fillLookFingerprints', () => {
  it('fills missing, redoes stale, leaves fresh ones alone', async () => {
    const { db, clips, highlights, clip } = setup();
    for (const [s, e] of [[1, 5], [10, 15], [20, 30]]) db.prepare("INSERT INTO highlights (clip_id, start_sec, end_sec, description, tier) VALUES (?, ?, ?, 'x', 'solid')").run(clip.id, s, e);
    const first = await fillLookFingerprints(clips.findByIds([clip.id]), { highlights }, { embedder: fake, grab });
    expect(first).toMatchObject({ created: 3, redone: 0, missing: 0 });
    const rows = highlights.findByClip(clip.id);
    expect(rows[0]!.look_model).toBe('fake');
    const vec = new Float32Array(rows[0]!.look_vec!.buffer, rows[0]!.look_vec!.byteOffset, 2);
    expect(vec[0]).toBeCloseTo(0.6); expect(vec[1]).toBeCloseTo(0.8);
    expect([rows[0]!.look_start_sec, rows[0]!.look_end_sec]).toEqual([1, 5]);

    fake.calls = 0;
    expect(await fillLookFingerprints(clips.findByIds([clip.id]), { highlights }, { embedder: fake, grab })).toMatchObject({ created: 0, redone: 0 });
    expect(fake.calls).toBe(0);

    db.prepare('UPDATE highlights SET end_sec = 6 WHERE id = ?').run(rows[0]!.id);
    const third = await fillLookFingerprints(clips.findByIds([clip.id]), { highlights }, { embedder: fake, grab });
    expect(third).toMatchObject({ created: 0, redone: 1, missing: 0 });
    expect(highlights.findByClip(clip.id)[0]!.look_end_sec).toBe(6);
  });

  it('a moment whose frames cannot be grabbed stays missing and is counted', async () => {
    const { db, clips, highlights, clip } = setup();
    db.prepare("INSERT INTO highlights (clip_id, start_sec, end_sec, description, tier) VALUES (?, 1, 5, 'x', 'solid')").run(clip.id);
    const r = await fillLookFingerprints(clips.findByIds([clip.id]), { highlights }, { embedder: fake, grab: async () => { throw new Error('boom'); } });
    expect(r).toMatchObject({ created: 0, missing: 1 });
    expect(highlights.findByClip(clip.id)[0]!.look_vec).toBeNull();
  });

  it('analyze: done clips get fingerprints without a Gemini call; new clips are analysed then fingerprinted', async () => {
    const { db, clips, highlights, clip } = setup();
    db.prepare("INSERT INTO highlights (clip_id, start_sec, end_sec, description, tier) VALUES (?, 1, 5, 'x', 'solid')").run(clip.id);
    const transcripts = new TranscriptRepository(db), motion = new MotionRepository(db);
    let gemini = 0;
    const client = { analyzeVideo: async () => { gemini++; return { scenes: [], clip_summary: 's', highlights: [{ start_sec: 8, end_sec: 12, description: 'x', tier: 'solid' as const, shot: 'wide' as const, role: 'action' as const }] } as any; } };
    const steps = { transcribe: async () => {}, measure: async () => {} };
    const look = { embedder: fake, grab };
    // only done clips -> no Gemini
    const r0 = await analyzeAware([], DEFAULT_CONFIG, { clips, highlights, transcripts, motion }, steps, () => {}, client, undefined, { look, doneClips: clips.findByIds([clip.id]) });
    expect(gemini).toBe(0);
    expect(r0.look).toMatchObject({ created: 1 });
    // a pending clip too
    const c2 = clips.insert({
      project_id: null, file_path: '/v/b.mp4', proxy_path: null, file_hash: 'h2', file_size: 1, duration_sec: 20, resolution: null,
      fps: 25, nb_frames: null, has_video: 1, has_audio: 1, codec: null, recorded_at: null, start_timecode: null,
      location: null, manual_tags: null, people: null,
    });
    const r1 = await analyzeAware(clips.findByIds([c2.id]), DEFAULT_CONFIG, { clips, highlights, transcripts, motion }, steps, () => {}, client, undefined, { look, doneClips: clips.findByIds([clip.id]) });
    expect(gemini).toBe(1);
    expect(r1.look).toMatchObject({ created: 1, redone: 0 });
    expect(highlights.findByClip(c2.id)[0]!.look_vec).not.toBeNull();
  });
});
