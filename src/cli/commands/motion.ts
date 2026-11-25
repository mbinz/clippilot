import { Command } from 'commander';
import chalk from 'chalk';
import { createDb } from '../../db/connection.js';
import { runMigrations } from '../../db/migrations/runner.js';
import { ClipRepository } from '../../db/repositories/clip.repository.js';
import { ProjectRepository } from '../../db/repositories/project.repository.js';
import { HighlightRepository } from '../../db/repositories/highlight.repository.js';
import { resolveDbPath } from '../../utils/fs.js';
import { loadConfig } from '../../core/config/manager.js';
import { MotionRepository } from '../../db/repositories/motion.repository.js';
import { measureClips, type MotionOptions } from '../../core/motion/index.js';
import { resolveProject } from './resolve-project.js';
import { runShakeFit, shakeFitLine, type ShakesInject } from './shakes.js';

export function registerMotionCommand(parent: Command, inject: Pick<MotionOptions, 'source' | 'measurer' | 'exists'> & Pick<ShakesInject, 'verifier'> = {}): void {
  parent
    .command('motion')
    .description('Measure each clip once (motion curve + shakes), derive jitter / stillness of every moment, then run the shake fit (clippilot shakes fix)')
    .option('--project <name>', 'Project name (default: the only project)')
    .option('--force', 'Measure clips that already have a motion curve', false)
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
        const t0 = Date.now();
        const result = await measureClips(clips, {
          highlights: new HighlightRepository(db), motion: new MotionRepository(db),
        }, {
          cfg: config, force: options.force, source: inject.source, measurer: inject.measurer, exists: inject.exists,
          onProgress: (done, total, name) => log(`[${done}/${total}] ${name}`),
        });
        const fit = await runShakeFit(db, config, { projectId: project.id }, { verifier: inject.verifier, exists: inject.exists });
        const elapsed = Math.round((Date.now() - t0) / 100) / 10;
        if (options.json) {
          console.log(JSON.stringify({ project: project.name, ...result, shake_fit: { ...fit.result.totals, hint: fit.hint }, elapsed_sec: elapsed }, null, 2));
        } else {
          console.log(`Measured ${result.measured} clips, skipped ${result.skipped} (already done), ${result.failed} failed, in ${elapsed} s.`);
          console.log(`  Shakes: ${result.shakes.high + result.shakes.low} (${result.shakes.high} high, ${result.shakes.low} low confidence)`);
          console.log(`  Shake fit: ${shakeFitLine(fit.result)}`);
          console.log(`  Bands: ${result.bands.locked} locked, ${result.bands.stabilize} stabilize, ${result.bands.shaky} shaky.`);
          for (const e of result.errors) console.error(chalk.red(`  clip ${e.clip_id}: ${e.message}`));
        }
        if (fit.hint) console.error(chalk.yellow(fit.hint));
        if (result.failed > 0) process.exitCode = 1;
      } finally {
        db.close();
      }
    });
}
