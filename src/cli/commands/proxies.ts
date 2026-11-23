import { Command } from 'commander';
import path from 'node:path';
import { createDb } from '../../db/connection.js';
import { runMigrations } from '../../db/migrations/runner.js';
import { ClipRepository } from '../../db/repositories/clip.repository.js';
import { ProjectRepository } from '../../db/repositories/project.repository.js';
import { resolveDbPath } from '../../utils/fs.js';
import { DEFAULT_PROXY_RESOLUTION } from '../../constants.js';
import { rebuildProxies } from '../../core/ingest/proxy.js';
import { resolveProject } from './resolve-project.js';

export function registerProxiesCommand(parent: Command): void {
  const proxies = parent.command('proxies').description('Manage proxy files');

  proxies
    .command('rebuild')
    .description('Re-encode proxies (yuv420p, 1 s keyframes) for smooth browser playback and seeking')
    .option('--project <name>', 'Project name (default: the only project)')
    .option('--only-bad', 'Skip proxies that are already yuv420p', false)
    .option('--json', 'Emit JSON (progress lines go to stderr)')
    .action(async (options) => {
      const basePath = process.cwd();
      const db = createDb(resolveDbPath(basePath));
      runMigrations(db);
      const project = resolveProject(new ProjectRepository(db), options.project);
      if (!project) return;

      const clips = new ClipRepository(db).listByProject(project.id).map((c) => ({
        id: c.id,
        file_path: c.file_path,
        proxy_path: c.proxy_path ? path.resolve(basePath, c.proxy_path) : null,
      }));
      const { results, summary } = await rebuildProxies(clips, {
        resolution: DEFAULT_PROXY_RESOLUTION,
        onlyBad: options.onlyBad,
        onProgress: (line) => (options.json ? console.error(line) : console.log(line)),
      });
      if (options.json) {
        console.log(JSON.stringify({ project: project.name, summary, results }, null, 2));
      } else {
        console.log(`Done: ${summary.ok} rebuilt, ${summary.skipped} skipped, ${summary.failed} failed (of ${summary.total}).`);
      }
      if (summary.failed > 0) process.exitCode = 1;
    });
}
