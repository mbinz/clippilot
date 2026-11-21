import { Command } from 'commander';
import chalk from 'chalk';
import { createDb } from '../../db/connection.js';
import { runMigrations } from '../../db/migrations/runner.js';
import { ClipRepository } from '../../db/repositories/clip.repository.js';
import { ProjectRepository } from '../../db/repositories/project.repository.js';
import { HighlightRepository } from '../../db/repositories/highlight.repository.js';
import { resolveDbPath } from '../../utils/fs.js';
import { loadConfig } from '../../core/config/manager.js';
import { recomputeDupGroups } from '../../core/similarity/dup-groups.js';
import { ThumbnailRepository } from '../../db/repositories/thumbnail.repository.js';
import { analyzeClips } from '../../core/analyze/index.js';
import { parseClipIds } from '../../core/calibration/sampling.js';
import { createProgressBar } from '../formatters/progress.js';

export function registerAnalyzeCommand(parent: Command): void {
  parent
    .command('analyze')
    .description('Run AI analysis on pending clips (uses proxies)')
    .option('--project <name>', 'Only analyze clips from this project')
    .option('--force', 'Re-analyze already analyzed clips', false)
    .option('--clips <ids>', 'Only analyze these clip ids (comma-separated); works with --force')
    .option('--retry-errors', 'Reset clips that failed analysis to pending before analyzing', false)
    .action(async (options) => {
      const basePath = process.cwd();
      let clipIds: number[] | undefined;
      try {
        clipIds = options.clips ? parseClipIds(options.clips) : undefined;
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }
      const config = await loadConfig(basePath);

      if (!config.gemini_api_key) {
        console.error(chalk.red('Error: Gemini API key not configured.'));
        console.error(chalk.yellow('Set GEMINI_API_KEY environment variable or run: clippilot config set gemini_api_key <key>'));
        process.exit(1);
      }

      const db = createDb(resolveDbPath(basePath));
      runMigrations(db);
      const clipRepo = new ClipRepository(db);
      const highlightRepo = new HighlightRepository(db);

      if (options.force) {
        clipRepo.resetAnalysis(undefined, clipIds);
      }

      if (options.retryErrors) {
        const project = options.project ? new ProjectRepository(db).findByName(options.project) : null;
        const reset = options.project && !project ? 0 : clipRepo.resetErrors(project?.id);
        console.log(`Reset ${reset} errored clips to pending.`);
      }

      const pending = clipRepo.findPending(undefined, clipIds);
      if (pending.length === 0) {
        console.log(chalk.yellow('No clips pending analysis.'));
        db.close();
        return;
      }

      console.log(`Found ${pending.length} clips to analyze...`);
      const bar = createProgressBar('Analyze');
      bar.start(pending.length, 0, { filename: '' });

      try {
        const result = await analyzeClips(pending, config, clipRepo, (current, filename) => {
          bar.update(current, { filename });
        }, highlightRepo);

        const projectIds = new Set(pending.map((c) => c.project_id).filter((id): id is number => id !== null));
        for (const projectId of projectIds) {
          await recomputeDupGroups(projectId, { clips: clipRepo, highlights: highlightRepo, thumbnails: new ThumbnailRepository(db) });
        }

        bar.stop();
        console.log('');
        console.log(chalk.green('Analysis complete'));
        console.log(`  Analyzed: ${result.success}`);
        console.log(`  Errors: ${result.errors}`);
      } catch (err) {
        bar.stop();
        throw err;
      } finally {
        db.close();
      }
    });
}
