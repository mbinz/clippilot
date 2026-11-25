import { describe, it, expect } from 'vitest';
import { setup } from '../storyboard/_helpers.js';
import {
  atempoChain, buildPreviewGraph, buildPreviewArgs, previewSegments, estimateCost, type PreviewSegment,
} from '../../../../src/core/critic/preview.js';

const seg = (o: Partial<PreviewSegment> = {}): PreviewSegment => ({
  label: 'S1·P1', file: '/p/a.mp4', start: 2, end: 6, speed: 1, keepAudio: false, hasAudio: true, ...o,
});

describe('atempoChain', () => {
  it('is one atempo for speeds the filter accepts and chains halves below 0.5', () => {
    expect(atempoChain(1)).toBe('');
    expect(atempoChain(0.5)).toBe('atempo=0.5');
    expect(atempoChain(0.25)).toBe('atempo=0.5,atempo=0.5');
    expect(atempoChain(2)).toBe('atempo=2');
  });
});

describe('buildPreviewGraph', () => {
  it('slows video with setpts and audio with atempo, scales to 480p and overlays the label', () => {
    const g = buildPreviewGraph([seg({ speed: 0.5 })]);
    expect(g).toContain('[0:v]setpts=(PTS-STARTPTS)/0.5,scale=854:480');
    expect(g).toContain('[1:v]');
    expect(g).toContain('overlay=8:8');
    expect(g).toContain('[0:a]asetpts=PTS-STARTPTS,atempo=0.5');
  });

  it('keeps audio of keep-audio panels at full volume and bleds the rest to -18 dB', () => {
    const g = buildPreviewGraph([seg({ keepAudio: true }), seg({ keepAudio: false })]);
    const [a0, a1] = [g.match(/\[0:a\][^;]*\[a0\]/)![0], g.match(/\[1:a\][^;]*\[a1\]/)![0]];
    expect(a0).not.toContain('volume');
    expect(a1).toContain('volume=-18dB');
  });

  it('makes silence of the played length for a clip without audio, and concats all segments', () => {
    const g = buildPreviewGraph([seg({ hasAudio: false, start: 0, end: 4, speed: 0.5 }), seg()]);
    expect(g).toMatch(/anullsrc=r=48000:cl=stereo,atrim=duration=8[^;]*\[a0\]/);
    expect(g).toMatch(/\[v0\]\[a0\]\[v1\]\[a1\]concat=n=2:v=1:a=1\[v\]\[a\]$/);
  });
});

describe('buildPreviewArgs', () => {
  it('seeks every source input to its range and loops each label image for the played length', () => {
    const args = buildPreviewArgs([seg({ speed: 0.5 })], ['/tmp/l0.png'], '/out/p.mp4');
    const s = args.join(' ');
    expect(s).toContain('-ss 2 -t 4 -i /p/a.mp4');
    expect(s).toContain('-loop 1 -framerate 25 -t 8 -i /tmp/l0.png');
    expect(s).toContain('-filter_complex');
    expect(s).toContain('-map [v] -map [a]');
    expect(s).toMatch(/-c:v libx264.*-c:a aac.*\/out\/p\.mp4$/);
  });
});

describe('previewSegments', () => {
  it('walks filled panels (first candidate for candidate panels), skips gaps, labels them and flags missing audio', () => {
    const s = setup();
    const a = s.addClip();
    const b = s.addClip();
    s.db.prepare('UPDATE clips SET has_audio = 0, proxy_path = ? WHERE id = ?').run('/p/b.mp4', b.id);
    const [m1, m2, m3] = [s.addMoments(a.id, [{ start_sec: 1, end_sec: 3 }])[0]!, s.addMoments(b.id, [{ start_sec: 4, end_sec: 8 }])[0]!, s.addMoments(a.id, [{ start_sec: 10, end_sec: 12 }])[0]!];
    s.db.prepare('UPDATE highlights SET audio_keep = 1, speed = 0.5 WHERE id = ?').run(m1);
    const cut = s.svc.createCut(s.projectId, 'Main');
    const sc1 = s.svc.addScene(cut.id, 'one');
    const sc2 = s.svc.addScene(cut.id, 'two');
    s.svc.addPanel(sc1.id, { intent: 'a', momentId: m1!, source: 'ai' });
    s.svc.addPanel(sc1.id, { intent: 'gap', source: 'ai' });
    s.svc.addPanel(sc2.id, { intent: 'c', candidates: [m2!, m3!], source: 'ai' });
    const segs = previewSegments(s.svc.getCut(cut.id)!, (id) => {
      const c = s.db.prepare('SELECT file_path, proxy_path, has_audio FROM clips WHERE id = ?').get(id) as { file_path: string; proxy_path: string | null; has_audio: number };
      return { file: c.proxy_path ?? c.file_path, hasAudio: c.has_audio === 1 };
    });
    expect(segs).toEqual([
      { label: 'S1·P1', file: '/v/c1.mp4', start: 1, end: 3, speed: 0.5, keepAudio: true, hasAudio: true },
      { label: 'S2·P1', file: '/p/b.mp4', start: 4, end: 8, speed: 1, keepAudio: false, hasAudio: false },
    ]);
  });
});

describe('estimateCost [D-11]', () => {
  it('prices video at ~300 tokens/s plus prompt text at $1.25 / M in and $10 / M out', () => {
    const e = estimateCost({ duration_sec: 600, prompt_chars: 4000, output_tokens: 4000 });
    expect(e.input_tokens).toBe(600 * 300 + 1000);
    expect(e.output_tokens).toBe(4000);
    expect(e.estimate_usd).toBeCloseTo(181000 * 1.25 / 1e6 + 4000 * 10 / 1e6, 3);
  });

  it('uses the long-context price above 200k input tokens', () => {
    const short = estimateCost({ duration_sec: 600, prompt_chars: 0, output_tokens: 0 });
    const long = estimateCost({ duration_sec: 1000, prompt_chars: 0, output_tokens: 0 });
    expect(long.estimate_usd).toBeCloseTo(300000 * 2.5 / 1e6, 3);
    expect(short.estimate_usd).toBeCloseTo(180000 * 1.25 / 1e6, 3);
  });
});
