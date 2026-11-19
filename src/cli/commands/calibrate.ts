import { Command } from 'commander';
import { createDb } from '../../db/connection.js';
import { runMigrations } from '../../db/migrations/runner.js';
import { ProjectRepository } from '../../db/repositories/project.repository.js';
import { CalibrationRepository } from '../../db/repositories/calibration.repository.js';
import { resolveDbPath } from '../../utils/fs.js';
import { ClipRepository } from '../../db/repositories/clip.repository.js';
import { HighlightRepository, type HighlightRecord } from '../../db/repositories/highlight.repository.js';
import { cameraKey, detectReasons, sampleCalibrationClips, type SampleCandidate } from '../../core/calibration/sampling.js';
import path from 'node:path';
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

  calibrate
    .command('sample')
    .description('Pick fresh, hard, stratified clips for the next calibration round (JSON)')
    .option('--n <count>', 'Number of clips', '8')
    .option('--seed <int>', 'PRNG seed (default: number of rounds so far)')
    .option('--project <name>', 'Project name (default: the only project)')
    .action((options) => {
      const db = createDb(resolveDbPath(process.cwd()));
      runMigrations(db);
      try {
        const project = resolveProject(new ProjectRepository(db), options.project);
        if (!project) return;
        const calib = new CalibrationRepository(db);
        const reviewed = calib.reviewedClipIds();
        const momentsByClip = new Map<number, HighlightRecord[]>();
        for (const h of new HighlightRepository(db).listByProject(project.id)) {
          (momentsByClip.get(h.clip_id) ?? momentsByClip.set(h.clip_id, []).get(h.clip_id)!).push(h);
        }
        const pool: SampleCandidate[] = new ClipRepository(db).listByProject(project.id)
          .filter((c) => c.analysis_status === 'done' && !reviewed.has(c.id))
          .map((c) => ({
            clip_id: c.id,
            file_name: path.basename(c.file_path),
            scene_hint: c.scene_hint,
            camera: cameraKey(c.resolution, c.fps),
            reasons: detectReasons(c, momentsByClip.get(c.id) ?? []),
          }));
        const n = Number.parseInt(options.n, 10);
        const seed = options.seed !== undefined ? Number.parseInt(options.seed, 10) : calib.roundCount();
        if (!Number.isInteger(n) || n < 1 || !Number.isInteger(seed)) {
          console.error('--n must be a positive integer and --seed an integer');
          process.exitCode = 1;
          return;
        }
        const picks = sampleCalibrationClips(pool, { n, seed });
        console.log(JSON.stringify({ clip_ids: picks.map((p) => p.clip_id), picks }, null, 2));
      } finally {
        db.close();
      }
    });
}
