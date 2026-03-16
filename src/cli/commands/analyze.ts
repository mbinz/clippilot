import { Command } from 'commander';
import chalk from 'chalk';
import { createDb } from '../../db/connection.js';
import { runMigrations } from '../../db/migrations/runner.js';
import { ClipRepository } from '../../db/repositories/clip.repository.js';
import { resolveDbPath } from '../../utils/fs.js';
import { loadConfig } from '../../core/config/manager.js';
import { analyzeClips } from '../../core/analyze/index.js';
import { createProgressBar } from '../formatters/progress.js';

export function registerAnalyzeCommand(parent: Command): void {
  parent
    .command('analyze')
    .description('Run AI analysis on pending clips (uses proxies)')
    .option('--project <name>', 'Only analyze clips from this project')
    .option('--force', 'Re-analyze already analyzed clips', false)
    .action(async (options) => {
      const basePath = process.cwd();
      const config = await loadConfig(basePath);

      if (!config.gemini_api_key) {
        console.error(chalk.red('Error: Gemini API key not configured.'));
        console.error(chalk.yellow('Set GEMINI_API_KEY environment variable or run: clippilot config set gemini_api_key <key>'));
        process.exit(1);
      }

      const db = createDb(resolveDbPath(basePath));
      runMigrations(db);
      const clipRepo = new ClipRepository(db);

      if (options.force) {
        clipRepo.resetAnalysis();
      }

      const pending = clipRepo.findPending();
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
        });

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
