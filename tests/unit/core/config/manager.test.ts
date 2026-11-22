import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig, saveGlobalConfigValue, globalConfigPath } from '../../../../src/core/config/manager.js';
import { CONFIG_PATH } from '../../../../src/constants.js';
import { DEFAULT_CONFIG } from '../../../../src/core/config/defaults.js';

describe('global config', () => {
  let root: string;
  let projectDir: string;
  let globalFile: string;
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    savedEnv = { ...process.env };
    delete process.env['GEMINI_API_KEY'];
    root = await mkdtemp(path.join(tmpdir(), 'clippilot-config-'));
    projectDir = path.join(root, 'project');
    globalFile = path.join(root, 'home', 'config.json');
    await mkdir(projectDir, { recursive: true });
  });

  afterEach(async () => {
    process.env = savedEnv;
    await rm(root, { recursive: true, force: true });
  });

  async function writeProject(obj: unknown) {
    const p = path.resolve(projectDir, CONFIG_PATH);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, JSON.stringify(obj));
  }
  async function writeGlobal(obj: unknown) {
    await mkdir(path.dirname(globalFile), { recursive: true });
    await writeFile(globalFile, typeof obj === 'string' ? obj : JSON.stringify(obj));
  }

  it('globalConfigPath honours CLIPPILOT_HOME, else ~/.clippilot', () => {
    process.env['CLIPPILOT_HOME'] = path.join(root, 'h');
    expect(globalConfigPath()).toBe(path.join(root, 'h', 'config.json'));
    delete process.env['CLIPPILOT_HOME'];
    expect(globalConfigPath()).toMatch(/\.clippilot[\\/]config\.json$/);
  });

  it('uses the global file when there is no project file', async () => {
    await writeGlobal({ gemini_api_key: 'g-key' });
    const cfg = await loadConfig(projectDir, globalFile);
    expect(cfg.gemini_api_key).toBe('g-key');
  });

  it('works with neither file present', async () => {
    const cfg = await loadConfig(projectDir, globalFile);
    expect(cfg.gemini_api_key).toBe(DEFAULT_CONFIG.gemini_api_key);
  });

  it('project overrides global per key, unrelated global fields survive', async () => {
    await writeGlobal({ gemini_api_key: 'g-key', gemini_model: 'g-model' });
    await writeProject({ gemini_api_key: 'p-key' });
    const cfg = await loadConfig(projectDir, globalFile);
    expect(cfg.gemini_api_key).toBe('p-key');
    expect((cfg as any).gemini_model).toBe('g-model');
  });

  it('env overrides global and project', async () => {
    await writeGlobal({ gemini_api_key: 'g-key' });
    await writeProject({ gemini_api_key: 'p-key' });
    process.env['GEMINI_API_KEY'] = 'e-key';
    const cfg = await loadConfig(projectDir, globalFile);
    expect(cfg.gemini_api_key).toBe('e-key');
  });

  it('merges nested proxy across defaults, global and project', async () => {
    await writeGlobal({ proxy: { crf: 20, resolution: 480 } });
    await writeProject({ proxy: { resolution: 1080 } });
    const cfg = await loadConfig(projectDir, globalFile);
    expect(cfg.proxy).toEqual({ ...DEFAULT_CONFIG.proxy, crf: 20, resolution: 1080 });
  });

  it('merges nested quality_weights across layers', async () => {
    const keys = Object.keys(DEFAULT_CONFIG.quality_weights);
    const [a, b] = keys;
    await writeGlobal({ quality_weights: { [a!]: 0.11 } });
    await writeProject({ quality_weights: { [b!]: 0.22 } });
    const cfg = await loadConfig(projectDir, globalFile);
    expect((cfg.quality_weights as any)[a!]).toBe(0.11);
    expect((cfg.quality_weights as any)[b!]).toBe(0.22);
  });

  it('broken global JSON throws an error naming the file', async () => {
    await writeGlobal('{ not json');
    await expect(loadConfig(projectDir, globalFile)).rejects.toThrow(globalFile);
  });

  it('broken project JSON throws an error naming the file', async () => {
    const p = path.resolve(projectDir, CONFIG_PATH);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, '{ nope');
    await expect(loadConfig(projectDir, globalFile)).rejects.toThrow(p);
  });

  it('reads the file once when project and global are the same file', async () => {
    const same = path.resolve(projectDir, CONFIG_PATH);
    await writeProject({ proxy: { crf: 19 } });
    const cfg = await loadConfig(projectDir, same);
    expect(cfg.proxy.crf).toBe(19);
  });

  it('saveGlobalConfigValue creates the dir, mode 0600, keeps other keys', async () => {
    await saveGlobalConfigValue('gemini_api_key', 'k1', globalFile);
    await saveGlobalConfigValue('gemini_model', 'm1', globalFile);
    const st = await stat(globalFile);
    expect(st.mode & 0o777).toBe(0o600);
    const saved = JSON.parse(await readFile(globalFile, 'utf-8'));
    expect(saved).toEqual({ gemini_api_key: 'k1', gemini_model: 'm1' });
  });
});
