import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { isVideoFile } from '../../utils/fs.js';
import { CLIPPILOT_DIR } from '../../constants.js';

export async function scanDirectory(dirPath: string): Promise<string[]> {
  const results: string[] = [];
  await walkDir(dirPath, results);
  results.sort();
  return results;
}

async function walkDir(dirPath: string, results: string[]): Promise<void> {
  const entries = await readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      // Skip hidden directories and .clippilot
      if (entry.name.startsWith('.') || entry.name === CLIPPILOT_DIR) continue;
      await walkDir(fullPath, results);
    } else if (entry.isFile() && isVideoFile(entry.name)) {
      results.push(fullPath);
    }
  }
}
