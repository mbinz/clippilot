import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { AppConfig } from '../../types/config.js';
import { DEFAULT_CONFIG } from './defaults.js';
import { CONFIG_PATH } from '../../constants.js';
import { ensureDir } from '../../utils/fs.js';

/** Reads a variable from the macOS launchd environment. Throws if unavailable. */
function defaultLaunchctlGetenv(name: string): string {
  return execFileSync('launchctl', ['getenv', name], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

/**
 * Key resolution order: GEMINI_API_KEY env, then .clippilot/config.json,
 * then (darwin only) `launchctl getenv`. The getter and platform are injectable for tests.
 */
export async function loadConfig(
  basePath: string,
  launchctlGetenv: (name: string) => string = defaultLaunchctlGetenv,
  platform: NodeJS.Platform = process.platform,
): Promise<AppConfig> {
  const configPath = path.resolve(basePath, CONFIG_PATH);
  let fileConfig: Partial<AppConfig> = {};

  if (existsSync(configPath)) {
    const raw = await readFile(configPath, 'utf-8');
    fileConfig = JSON.parse(raw);
  }

  // Env var overrides
  const envKey = process.env['GEMINI_API_KEY'];

  const config: AppConfig = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    proxy: { ...DEFAULT_CONFIG.proxy, ...fileConfig.proxy },
    quality_weights: { ...DEFAULT_CONFIG.quality_weights, ...fileConfig.quality_weights },
  };

  if (envKey) {
    config.gemini_api_key = envKey;
  } else if (!fileConfig.gemini_api_key && platform === 'darwin') {
    try {
      const key = launchctlGetenv('GEMINI_API_KEY').trim();
      if (key) config.gemini_api_key = key;
    } catch {
      // launchctl missing, non-zero exit, etc.: no key
    }
  }

  return config;
}

export async function saveConfig(basePath: string, config: Partial<AppConfig>): Promise<void> {
  const configPath = path.resolve(basePath, CONFIG_PATH);
  await ensureDir(path.dirname(configPath));
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
}
