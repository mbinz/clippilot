import { Command } from 'commander';
import { createDb } from '../../db/connection.js';
import { runMigrations } from '../../db/migrations/runner.js';
import { ProjectRepository } from '../../db/repositories/project.repository.js';
import { CalibrationRepository } from '../../db/repositories/calibration.repository.js';
import { resolveDbPath } from '../../utils/fs.js';
import { resolveProject } from './resolve-project.js';

export function registerCalibrateCommand(parent: Command): void {
  const calibrate = parent.command('calibrate').description('Taste calibration loop');
  calibrate
    .command('status')
    .description('Calibration rounds with metrics and profile version, newest first (JSON)')
    .option('--json', 'JSON output (default)', true)
    .option('--project <name>', 'Project name (default: the only project)')
    .action((options) => {
      const db = createDb(resolveDbPath(process.cwd()));
      runMigrations(db);
      try {
        const project = resolveProject(new ProjectRepository(db), options.project);
        if (!project) return;
        console.log(JSON.stringify({ rounds: new CalibrationRepository(db).listRounds(project.id) }, null, 2));
      } finally {
        db.close();
      }
    });
}
