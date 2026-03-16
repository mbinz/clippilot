import { Command } from 'commander';
import chalk from 'chalk';
import { createDb } from '../../db/connection.js';
import { runMigrations } from '../../db/migrations/runner.js';
import { ClipRepository } from '../../db/repositories/clip.repository.js';
import { ProjectRepository } from '../../db/repositories/project.repository.js';
import { resolveDbPath } from '../../utils/fs.js';
import { formatStatsTable } from '../formatters/table.js';
import { formatDuration } from '../../utils/timecode.js';

export function registerStatsCommand(parent: Command): void {
  parent
    .command('stats')
    .description('Show project statistics')
    .option('--project <name>', 'Show stats for specific project')
    .action(async (options) => {
      const basePath = process.cwd();
      const db = createDb(resolveDbPath(basePath));
      runMigrations(db);

      try {
        const clipRepo = new ClipRepository(db);
        const projectRepo = new ProjectRepository(db);
        const projects = projectRepo.list();

        if (projects.length === 0) {
          console.log(chalk.yellow('No projects found. Run "clippilot ingest <path>" first.'));
          return;
        }

        for (const project of projects) {
          if (options.project && project.name !== options.project) continue;

          const stats = clipRepo.getStats(project.id);
          console.log(chalk.bold(`\nProject: ${project.name}`));
          console.log(formatStatsTable({
            'Total Clips': stats.total,
            'Analyzed': stats.analyzed,
            'Pending': stats.pending,
            'Errors': stats.error,
            'Total Duration': formatDuration(stats.totalDuration),
          }));
        }
      } finally {
        db.close();
      }
    });
}
