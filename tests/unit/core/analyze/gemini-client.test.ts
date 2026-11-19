import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GeminiClient } from '../../../../src/core/analyze/gemini-client.js';
import type { AppConfig } from '../../../../src/types/config.js';

const validResponse = JSON.stringify({
  scenes: [
    {
      start_sec: 0, end_sec: 4, description_de: 'Hafen', description_en: 'Harbour',
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
