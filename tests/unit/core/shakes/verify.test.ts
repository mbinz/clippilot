import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { buildShakePrompt, createGeminiShakeVerifier, segmentBounds } from '../../../../src/core/shakes/verify.js';

describe('shake check (Gemini)', () => {
  it('segmentBounds: range +- 0.5 s, inside the clip', () => {
    expect(segmentBounds({ start: 2, end: 12 }, 30)).toEqual({ from: 1.5, to: 12.5 });
    expect(segmentBounds({ start: 0.2, end: 29.9 }, 30)).toEqual({ from: 0, to: 30 });
  });

  it('prompt: times are relative to the excerpt, shakes clipped to the range, kept parts listed', () => {
    const p = buildShakePrompt({
      description: 'they kiss', range: { start: 7, end: 10 }, shakes: [{ start_sec: 8.02, end_sec: 8.14 }],
      parts: [{ start: 7, end: 7.98 }, { start: 8.18, end: 10 }], from: 6.5,
    });
    expect(p.user).toContain('The moment we want to use: 0.50-3.50 s.');
    expect(p.user).toContain('"they kiss"');
    expect(p.user).toContain('The camera shakes (a sudden jolt) at: 1.52-1.64 s.');
    expect(p.user).toContain('The edit keeps only: 0.50-1.48 s, 1.68-3.50 s.');
    expect(p.user).toContain('{"keeps_content": true or false, "reason": "one short sentence"}');
  });

  it('sends the re-encoded excerpt inline with the prompt to the configured model; retries 429/503 with backoff', async () => {
    const extracted: unknown[] = [];
    const requests: any[] = [];
    const sleeps: number[] = [];
    let n = 0;
    const v = createGeminiShakeVerifier('key', 'gemini-test', {
      extract: async (source, from, to, out) => { extracted.push([source, from, to]); fs.writeFileSync(out, Buffer.from('VIDEO')); },
      generate: async (req) => {
        requests.push(req);
        if (n++ < 2) throw Object.assign(new Error('busy'), { status: 429 });
        return '{"keeps_content": true, "reason": "ok"}';
      },
      sleep: async (ms) => { sleeps.push(ms); },
    });
    const out = await v.verify({ source: '/p/a.mp4', from: 1.5, to: 12.5, prompt: { system: 'SYS', user: 'USER' } });
    expect(JSON.parse(out)).toEqual({ keeps_content: true, reason: 'ok' });
    expect(extracted).toEqual([['/p/a.mp4', 1.5, 12.5]]);
    expect(sleeps).toEqual([1000, 2000]);
    expect(requests[0]).toMatchObject({ model: 'gemini-test', config: { systemInstruction: 'SYS', responseMimeType: 'application/json' } });
    expect(requests[0].contents[0].parts).toEqual([
      { inlineData: { mimeType: 'video/mp4', data: Buffer.from('VIDEO').toString('base64') } }, { text: 'USER' }]);
  });

  it('other API errors are not retried', async () => {
    let n = 0;
    const v = createGeminiShakeVerifier('key', 'm', {
      extract: async (_s, _f, _t, out) => { fs.writeFileSync(out, 'x'); },
      generate: async () => { n++; throw Object.assign(new Error('bad key'), { status: 403 }); },
      sleep: async () => {},
    });
    await expect(v.verify({ source: 's', from: 0, to: 1, prompt: { system: '', user: '' } })).rejects.toThrow('bad key');
    expect(n).toBe(1);
  });
});
