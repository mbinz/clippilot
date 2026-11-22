import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../../../src/core/config/manager.js';
import { CONFIG_PATH } from '../../../../src/constants.js';
import { DEFAULT_CONFIG } from '../../../../src/core/config/defaults.js';

describe('loadConfig gemini key resolution', () => {
  let dir: string;
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    savedEnv = { ...process.env };
    delete process.env['GEMINI_API_KEY'];
    dir = await mkdtemp(path.join(tmpdir(), 'clippilot-config-'));
  });

  afterEach(async () => {
    process.env = savedEnv;
    await rm(dir, { recursive: true, force: true });
  });

  async function writeFileKey(key: string) {
    const p = path.resolve(dir, CONFIG_PATH);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, JSON.stringify({ gemini_api_key: key }));
  }

  it('env wins over file and launchctl', async () => {
    process.env['GEMINI_API_KEY'] = 'env-key';
    await writeFileKey('file-key');
    const getter = vi.fn(() => 'launchctl-key');
    const cfg = await loadConfig(dir, getter, 'darwin');
    expect(cfg.gemini_api_key).toBe('env-key');
    expect(getter).not.toHaveBeenCalled();
  });

  it('file wins over launchctl (launchctl not called)', async () => {
    await writeFileKey('file-key');
    const getter = vi.fn(() => 'launchctl-key');
    const cfg = await loadConfig(dir, getter, 'darwin');
    expect(cfg.gemini_api_key).toBe('file-key');
    expect(getter).not.toHaveBeenCalled();
  });

  it('uses launchctl when env and file are missing', async () => {
    const getter = vi.fn(() => 'launchctl-key');
    const cfg = await loadConfig(dir, getter, 'darwin');
    expect(cfg.gemini_api_key).toBe('launchctl-key');
    expect(getter).toHaveBeenCalledWith('GEMINI_API_KEY');
  });

  it('does not call launchctl on non-darwin', async () => {
    const getter = vi.fn(() => 'launchctl-key');
    const cfg = await loadConfig(dir, getter, 'linux');
    expect(getter).not.toHaveBeenCalled();
    expect(cfg.gemini_api_key).toBe(DEFAULT_CONFIG.gemini_api_key);
  });

  it('keeps default key when the getter throws', async () => {
    const getter = vi.fn(() => {
      throw new Error('launchctl missing');
    });
    const cfg = await loadConfig(dir, getter, 'darwin');
    expect(cfg.gemini_api_key).toBe(DEFAULT_CONFIG.gemini_api_key);
  });

  it('keeps default key when the getter returns empty/whitespace', async () => {
    const cfg = await loadConfig(dir, () => '  \n', 'darwin');
    expect(cfg.gemini_api_key).toBe(DEFAULT_CONFIG.gemini_api_key);
  });
});
