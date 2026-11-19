import { readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface TasteProfile {
  version: number;
  text: string;
}

/** Per-user profile dir: $CLIPPILOT_HOME or ~/.clippilot. */
export function tasteProfileDir(): string {
  return process.env.CLIPPILOT_HOME ?? path.join(os.homedir(), '.clippilot');
}

/** Highest `taste-profile.v<N>.md`, else `taste-profile.md` as v1, else null. */
export function loadTasteProfile(dir: string): TasteProfile | null {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  let best: { version: number; file: string } | null = null;
  for (const name of names) {
    const m = /^taste-profile\.v(\d+)\.md$/.exec(name);
    if (m && (!best || Number(m[1]) > best.version)) best = { version: Number(m[1]), file: name };
  }
  if (!best && names.includes('taste-profile.md')) best = { version: 1, file: 'taste-profile.md' };
  if (!best) return null;
  return { version: best.version, text: readFileSync(path.join(dir, best.file), 'utf8').trim() };
}
