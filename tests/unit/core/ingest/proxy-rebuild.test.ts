import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rebuildProxy, rebuildProxies, maxKeyframeGap } from '../../../../src/core/ingest/proxy.js';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-proxy-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const write = (name: string, body: string) => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, body);
  return p;
};

describe('rebuildProxy', () => {
  it('encodes to <proxy>.partial.mp4 and atomically replaces the proxy', async () => {
    const input = write('orig.MP4', 'orig');
    const proxy = write('p.mp4', 'old');
    const seen: string[] = [];
    await rebuildProxy(input, proxy, 720, async (_i, out) => {
      seen.push(out);
      fs.writeFileSync(out, 'new');
    });
    expect(seen).toEqual([path.join(dir, 'p.partial.mp4')]);
    expect(fs.readFileSync(proxy, 'utf8')).toBe('new');
    expect(fs.existsSync(seen[0])).toBe(false);
  });

  it('keeps the old proxy and removes the partial when encoding fails', async () => {
    const input = write('orig.MP4', 'orig');
    const proxy = write('p.mp4', 'old');
    await expect(
      rebuildProxy(input, proxy, 720, async (_i, out) => {
        fs.writeFileSync(out, 'half');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(fs.readFileSync(proxy, 'utf8')).toBe('old');
    expect(fs.readdirSync(dir).sort()).toEqual(['orig.MP4', 'p.mp4']);
  });
});

describe('rebuildProxies', () => {
  const encode = async (_i: string, out: string) => { fs.writeFileSync(out, 'new'); };

  it('skips and reports clips whose original is missing', async () => {
    const proxy = write('p.mp4', 'old');
    const res = await rebuildProxies(
      [{ id: 1, file_path: path.join(dir, 'gone.MP4'), proxy_path: proxy }],
      { resolution: 720, encode },
    );
    expect(res.results[0]).toMatchObject({ status: 'skipped', reason: 'original missing' });
    expect(fs.readFileSync(proxy, 'utf8')).toBe('old');
  });

  it('--only-bad skips proxies that are already yuv420p', async () => {
    const o1 = write('a.MP4', 'x'); const p1 = write('a.mp4', 'old1');
    const o2 = write('b.MP4', 'x'); const p2 = write('b.mp4', 'old2');
    const res = await rebuildProxies(
      [
        { id: 1, file_path: o1, proxy_path: p1 },
        { id: 2, file_path: o2, proxy_path: p2 },
      ],
      { resolution: 720, onlyBad: true, encode, probeKeyframeGap: async () => 1, probePixFmt: async (p) => (p === p1 ? 'yuv420p' : 'yuv422p10le') },
    );
    expect(res.results.map((r) => r.status)).toEqual(['skipped', 'ok']);
    expect(fs.readFileSync(p1, 'utf8')).toBe('old1');
    expect(fs.readFileSync(p2, 'utf8')).toBe('new');
    expect(res.summary).toEqual({ total: 2, ok: 1, skipped: 1, failed: 0 });
  });

  it('records a failure and continues with the next clip', async () => {
    const o1 = write('a.MP4', 'x'); const p1 = write('a.mp4', 'old1');
    const o2 = write('b.MP4', 'x'); const p2 = write('b.mp4', 'old2');
    const lines: string[] = [];
    const res = await rebuildProxies(
      [
        { id: 1, file_path: o1, proxy_path: p1 },
        { id: 2, file_path: o2, proxy_path: p2 },
      ],
      {
        resolution: 720,
        encode: async (i, out) => { if (i === o1) throw new Error('bad'); fs.writeFileSync(out, 'new'); },
        onProgress: (l) => lines.push(l),
      },
    );
    expect(res.summary).toEqual({ total: 2, ok: 1, skipped: 0, failed: 1 });
    expect(lines[0]).toBe('[1/2] a.MP4 failed: bad');
    expect(lines[1]).toBe('[2/2] b.MP4 ok');
    expect(fs.readFileSync(p1, 'utf8')).toBe('old1');
  });
});

describe('maxKeyframeGap', () => {
  it('1 s grid -> 1', () => { expect(maxKeyframeGap([0, 1, 2, 3], 4)).toBe(1); });
  it('finds a 10 s gap', () => { expect(maxKeyframeGap([0, 1, 11, 12], 13)).toBe(10); });
  it('includes the last keyframe to the end', () => { expect(maxKeyframeGap([0, 1], 9)).toBe(8); });
  it('single keyframe -> duration - t', () => { expect(maxKeyframeGap([0], 7)).toBe(7); });
  it('clip shorter than 1 s', () => { expect(maxKeyframeGap([0], 0.5)).toBe(0.5); });
  it('no keyframes -> whole duration', () => { expect(maxKeyframeGap([], 5)).toBe(5); });
});

describe('rebuildProxies --only-bad keyframe gap', () => {
  const encode = async (_i: string, out: string) => { fs.writeFileSync(out, 'new'); };
  it('rebuilds a yuv420p proxy with a 10 s gap, skips a good one (yuvj420p fine)', async () => {
    const o1 = write('a.MP4', 'x'); const p1 = write('a.mp4', 'old1');
    const o2 = write('b.MP4', 'x'); const p2 = write('b.mp4', 'old2');
    const res = await rebuildProxies(
      [
        { id: 1, file_path: o1, proxy_path: p1 },
        { id: 2, file_path: o2, proxy_path: p2 },
      ],
      {
        resolution: 720, onlyBad: true, encode,
        probePixFmt: async (p) => (p === p1 ? 'yuv420p' : 'yuvj420p'),
        probeKeyframeGap: async (p) => (p === p1 ? 10 : 1),
      },
    );
    expect(res.results.map((r) => r.status)).toEqual(['ok', 'skipped']);
    expect(fs.readFileSync(p1, 'utf8')).toBe('new');
    expect(fs.readFileSync(p2, 'utf8')).toBe('old2');
  });
});
