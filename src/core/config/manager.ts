import { readFile, writeFile, chmod } from 'node:fs/promises';
import os from 'node:os';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../../types/config.js';
import { DEFAULT_CONFIG } from './defaults.js';
import { CONFIG_PATH } from '../../constants.js';
import { ensureDir } from '../../utils/fs.js';

export function globalConfigPath(): string {
  const home = process.env['CLIPPILOT_HOME'];
  return path.join(home ? path.resolve(home) : path.join(os.homedir(), '.clippilot'), 'config.json');
}

async function readConfigFile(file: string): Promise<Partial<AppConfig>> {
  if (!existsSync(file)) return {};
  const raw = await readFile(file, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in config file ${file}: ${(err as Error).message}`);
  }
}

export async function loadConfig(
  basePath: string,
  globalPath: string = globalConfigPath(),
): Promise<AppConfig> {
  const projectPath = path.resolve(basePath, CONFIG_PATH);
  const globalFile = path.resolve(globalPath);
  const globalConfig = await readConfigFile(globalFile);
  const projectConfig = projectPath === globalFile ? {} : await readConfigFile(projectPath);

  const config: AppConfig = {
    ...DEFAULT_CONFIG,
    ...globalConfig,
    ...projectConfig,
    proxy: { ...DEFAULT_CONFIG.proxy, ...globalConfig.proxy, ...projectConfig.proxy },
    quality_weights: {
      ...DEFAULT_CONFIG.quality_weights,
      ...globalConfig.quality_weights,
      ...projectConfig.quality_weights,
    },
  };

  // Env var overrides everything
  const envKey = process.env['GEMINI_API_KEY'];
  if (envKey) {
    config.gemini_api_key = envKey;
  }

  return config;
}

/** Set one top-level key in the global config file (only that file's own contents are kept). */
export async function saveGlobalConfigValue(
  key: string,
  value: unknown,
  globalPath: string = globalConfigPath(),
): Promise<void> {
  const file = path.resolve(globalPath);
  const existing = await readConfigFile(file);
  await ensureDir(path.dirname(file));
  await writeFile(file, JSON.stringify({ ...existing, [key]: value }, null, 2), { encoding: 'utf-8', mode: 0o600 });
  await chmod(file, 0o600);
}

export async function saveConfig(basePath: string, config: Partial<AppConfig>): Promise<void> {
  const configPath = path.resolve(basePath, CONFIG_PATH);
  await ensureDir(path.dirname(configPath));
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
}
