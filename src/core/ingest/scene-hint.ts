import path from 'node:path';

/**
 * Scene hint for a file: its parent directory relative to the ingest root,
 * '/'-separated with segments kept verbatim. Files directly in the root get
 * the root folder's basename.
 */
export function sceneHintFor(rootDir: string, filePath: string): string {
  const rel = path.relative(rootDir, path.dirname(filePath));
  if (rel === '') return path.basename(rootDir);
  return rel.split(path.sep).join('/');
}
