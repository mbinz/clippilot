import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GeminiClient, buildRequest, INLINE_MAX_BYTES, type VideoTransport } from '../../../../src/core/analyze/gemini-client.js';
import { SYSTEM_PROMPT, USER_PROMPT } from '../../../../src/core/analyze/prompts.js';
import type { AppConfig } from '../../../../src/types/config.js';

const validResponse = JSON.stringify({
  scenes: [
    {
      start_sec: 0, end_sec: 4, description_en: 'Harbour',
      subjects: ['boat'], setting: 'marina', activity: 'docking', mood: 'calm',
      visual_keywords: ['water'],
    },
  ],
  clip_summary: 'A boat docks in a marina.',
  highlights: [{ start_sec: 1, end_sec: 3, description: 'Boat arrives', tier: 'solid', shot: 'medium', role: 'action' }],
});

describe('GeminiClient parse retries', () => {
  let dir: string;
  let proxy: string;
  const config = { gemini_api_key: 'k', gemini_model: 'm' } as AppConfig;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'gemini-client-'));
    proxy = path.join(dir, 'proxy.mp4');
    writeFileSync(proxy, 'tiny');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('retries once after malformed JSON and then succeeds', async () => {
    const generate = vi.fn().mockResolvedValueOnce('{"scenes": [ {').mockResolvedValueOnce(validResponse);
    const client = new GeminiClient(config, generate);
    const result = await client.analyzeVideo(proxy);
    expect(result.clip_summary).toBe('A boat docks in a marina.');
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('retries on schema-invalid JSON', async () => {
    const generate = vi.fn().mockResolvedValueOnce('{"scenes": []}').mockResolvedValueOnce(validResponse);
    const client = new GeminiClient(config, generate);
    await client.analyzeVideo(proxy);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('gives up after exactly 3 attempts and says so', async () => {
    const generate = vi.fn().mockResolvedValue('{"scenes": [ {');
    const client = new GeminiClient(config, generate);
    await expect(client.analyzeVideo(proxy)).rejects.toThrow(/3 attempts/);
    expect(generate).toHaveBeenCalledTimes(3);
  });
});

describe('buildRequest', () => {
  it('sends exactly USER_PROMPT as the text part, with no profile appended', () => {
    const req = buildRequest('m', { inlineData: { mimeType: 'video/mp4', data: 'QUJD' } });
    const parts = req.contents[0].parts;
    expect(parts[0]).toEqual({ inlineData: { mimeType: 'video/mp4', data: 'QUJD' } });
    expect(parts[1]).toEqual({ text: USER_PROMPT });
    expect(req.config.systemInstruction).toBe(SYSTEM_PROMPT);
  });
});

describe('buildRequest with a file part', () => {
  it('passes a fileData part through', () => {
    const part = { fileData: { fileUri: 'files/abc', mimeType: 'video/mp4' } };
    const req = buildRequest('m', part);
    expect(req.contents[0].parts[0]).toEqual(part);
    expect(req.contents[0].parts[1]).toEqual({ text: USER_PROMPT });
  });
});

describe('GeminiClient transport selection', () => {
  let dir: string;
  let proxy: string;
  const config = { gemini_api_key: 'k', gemini_model: 'm' } as AppConfig;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'gemini-transport-'));
    proxy = path.join(dir, 'proxy.mp4');
    writeFileSync(proxy, 'tiny');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const fakeTransport = (): VideoTransport & {
    upload: ReturnType<typeof vi.fn>; waitActive: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn>;
  } => ({
    upload: vi.fn().mockResolvedValue({ name: 'files/x', uri: 'https://files/x', mimeType: 'video/mp4' }),
    waitActive: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  });
  const large = async () => INLINE_MAX_BYTES; // base64 size = 4/3 of this, over the limit

  it('INLINE_MAX_BYTES is 18 MiB', () => {
    expect(INLINE_MAX_BYTES).toBe(18 * 1024 * 1024);
  });

  it('small file goes inline without upload', async () => {
    const t = fakeTransport();
    const generate = vi.fn().mockResolvedValue(validResponse);
    await new GeminiClient(config, generate, t).analyzeVideo(proxy);
    expect(t.upload).not.toHaveBeenCalled();
    expect(generate.mock.calls[0][0]).toHaveProperty('inlineData');
  });

  it('file whose base64 size is exactly at the limit stays inline', async () => {
    const t = fakeTransport();
    const generate = vi.fn().mockResolvedValue(validResponse);
    const size = async () => (INLINE_MAX_BYTES / 4) * 3;
    await new GeminiClient(config, generate, t, size).analyzeVideo(proxy);
    expect(t.upload).not.toHaveBeenCalled();
  });

  it('large file uploads once, waits, uses fileData, removes once', async () => {
    const t = fakeTransport();
    const generate = vi.fn().mockResolvedValueOnce('{"scenes": [ {').mockResolvedValueOnce(validResponse);
    await new GeminiClient(config, generate, t, large).analyzeVideo(proxy);
    expect(t.upload).toHaveBeenCalledTimes(1);
    expect(t.waitActive).toHaveBeenCalledWith('files/x');
    expect(generate).toHaveBeenCalledTimes(2);
    for (const call of generate.mock.calls) {
      expect(call[0]).toEqual({ fileData: { fileUri: 'https://files/x', mimeType: 'video/mp4' } });
    }
    expect(t.remove).toHaveBeenCalledTimes(1);
    expect(t.remove).toHaveBeenCalledWith('files/x');
  });

  it('removes the file even when generate throws', async () => {
    const t = fakeTransport();
    const generate = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(new GeminiClient(config, generate, t, large).analyzeVideo(proxy)).rejects.toThrow(/boom/);
    expect(t.remove).toHaveBeenCalledTimes(1);
  });

  it('swallows a failing remove', async () => {
    const t = fakeTransport();
    t.remove.mockRejectedValue(new Error('gone'));
    const generate = vi.fn().mockResolvedValue(validResponse);
    const result = await new GeminiClient(config, generate, t, large).analyzeVideo(proxy);
    expect(result.clip_summary).toBe('A boat docks in a marina.');
  });

  it('waitActive failure: no generate, remove called, GeminiApiError surfaces', async () => {
    const t = fakeTransport();
    t.waitActive.mockRejectedValue(new Error('FAILED processing'));
    const generate = vi.fn();
    const p = new GeminiClient(config, generate, t, large).analyzeVideo(proxy);
    await expect(p).rejects.toMatchObject({ name: 'GeminiApiError' });
    await expect(new GeminiClient(config, generate, t, large).analyzeVideo(proxy)).rejects.toThrow(/FAILED processing/);
    expect(generate).not.toHaveBeenCalled();
    expect(t.remove).toHaveBeenCalledTimes(2);
  });

  it('passes the measured-context text on to every generate call', async () => {
    const generate = vi.fn().mockResolvedValueOnce('nope').mockResolvedValueOnce(validResponse);
    await new GeminiClient(config, generate).analyzeVideo(proxy, 'Kamerawackler (gemessen): 1.00–1.20 s (stark)');
    expect(generate.mock.calls.map((c) => c[1])).toEqual(['Kamerawackler (gemessen): 1.00–1.20 s (stark)', 'Kamerawackler (gemessen): 1.00–1.20 s (stark)']);
  });
});
