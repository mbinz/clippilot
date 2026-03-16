import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { VIDEO_EXTENSIONS } from '../constants.js';

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

export function isVideoFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return VIDEO_EXTENSIONS.has(ext);
}

export function resolveClippilotDir(basePath: string): string {
  return path.resolve(basePath, '.clippilot');
}

export function resolveProxyDir(basePath: string): string {
  return path.resolve(basePath, '.clippilot', 'proxies');
}

export function resolveThumbnailDir(basePath: string): string {
  return path.resolve(basePath, '.clippilot', 'thumbnails');
}

export function resolveDbPath(basePath: string): string {
  return path.resolve(basePath, '.clippilot', 'clippilot.db');
}
