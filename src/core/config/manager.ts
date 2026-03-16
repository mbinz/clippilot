import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../../types/config.js';
import { DEFAULT_CONFIG } from './defaults.js';
import { CONFIG_PATH } from '../../constants.js';
import { ensureDir } from '../../utils/fs.js';

export async function loadConfig(basePath: string): Promise<AppConfig> {
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
  }

  return config;
}

export async function saveConfig(basePath: string, config: Partial<AppConfig>): Promise<void> {
  const configPath = path.resolve(basePath, CONFIG_PATH);
  await ensureDir(path.dirname(configPath));
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
}
