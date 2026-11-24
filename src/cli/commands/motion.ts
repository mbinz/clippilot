import { Command } from 'commander';
import chalk from 'chalk';
import { createDb } from '../../db/connection.js';
import { runMigrations } from '../../db/migrations/runner.js';
import { ClipRepository } from '../../db/repositories/clip.repository.js';
import { ProjectRepository } from '../../db/repositories/project.repository.js';
import { HighlightRepository } from '../../db/repositories/highlight.repository.js';
import { resolveDbPath } from '../../utils/fs.js';
import { loadConfig } from '../../core/config/manager.js';
import { measureClips, type MotionOptions } from '../../core/motion/index.js';
import { resolveProject } from './resolve-project.js';

export function registerMotionCommand(parent: Command, inject: Pick<MotionOptions, 'source' | 'exists'> = {}): void {
  parent
    .command('motion')
    .description('Measure shake and stillness of every moment (read-only: never changes ranges, status or source)')
    .option('--project <name>', 'Project name (default: the only project)')
    .option('--force', 'Measure moments that are already measured', false)
    .option('--json', 'Emit JSON (progress lines go to stderr)')
    .action(async (options) => {
      const basePath = process.cwd();
      const config = await loadConfig(basePath);
      const db = createDb(resolveDbPath(basePath));
      try {
        runMigrations(db);
        const project = resolveProject(new ProjectRepository(db), options.project);
        if (!project) return;
        const clips = new ClipRepository(db).listByProject(project.id);
        const log = options.json ? console.error : console.log;
        const result = await measureClips(clips, { highlights: new HighlightRepository(db) }, {
          cfg: config, force: options.force, ...inject,
          onProgress: (done, total, name) => log(`[${done}/${total}] ${name}`),
        });
        if (options.json) {
          console.log(JSON.stringify({ project: project.name, ...result }, null, 2));
        } else {
          console.log(`Measured ${result.measured}, skipped ${result.skipped} (already done), ${result.failed} failed.`);
          console.log(`  Bands: ${result.bands.locked} locked, ${result.bands.stabilize} stabilize, ${result.bands.shaky} shaky.`);
          for (const e of result.errors) console.error(chalk.red(`  clip ${e.clip_id} moment ${e.moment_id}: ${e.message}`));
        }
        if (result.failed > 0) process.exitCode = 1;
      } finally {
        db.close();
      }
    });
}
