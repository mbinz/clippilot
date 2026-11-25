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
import { TranscriptRepository } from '../../db/repositories/transcript.repository.js';
import { measureClips } from '../../core/motion/index.js';
import { runShakeFit, shakeFitLine } from './shakes.js';
import { MotionRepository } from '../../db/repositories/motion.repository.js';
import { transcribeClips, whisperModelAvailable, expandHome, resolveVadModel, vadMissingWarning } from '../../core/transcribe/index.js';
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
      const transcriptRepo = new TranscriptRepository(db);

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
        }, highlightRepo, undefined, transcriptRepo);

        const projectIds = new Set(pending.map((c) => c.project_id).filter((id): id is number => id !== null));
        for (const projectId of projectIds) {
          await recomputeDupGroups(projectId, { clips: clipRepo, highlights: highlightRepo, thumbnails: new ThumbnailRepository(db) });
        }

        bar.stop();
        console.log('');
        console.log(chalk.green('Analysis complete'));
        console.log(`  Analyzed: ${result.success}`);
        console.log(`  Errors: ${result.errors}`);

        // Spoken words: transcribe what has no transcript yet (needs the whisper model), else say how to enable it.
        const fresh = clipRepo.findByIds(pending.map((c) => c.id)).filter((c) => !transcriptRepo.has(c.id) && c.has_audio);
        if (fresh.length > 0) {
          if (whisperModelAvailable(config)) {
            console.log(`Transcribing ${fresh.length} clips...`);
            const vadModel = resolveVadModel(config);
            if (!vadModel) console.error(chalk.yellow(vadMissingWarning(config)));
            const t = await transcribeClips(fresh, { transcripts: transcriptRepo, highlights: highlightRepo },
              { model: expandHome(config.whisper_model), vadModel, vadThreshold: config.whisper_vad_threshold, vadPadMs: config.whisper_vad_pad_ms, languages: config.languages });
            console.log(`  Transcribed: ${t.transcribed}, errors: ${t.errors.length}, moments snapped to sentences: ${t.snapped}`);
          } else {
            console.log(chalk.yellow(`Hint: no whisper model at ${expandHome(config.whisper_model)}; run "clippilot transcribe" after downloading one (config key whisper_model).`));
          }
        }

        // Jitter and stillness of every moment that is not measured yet.
        const analyzed = clipRepo.findByIds(pending.map((c) => c.id));
        console.log('Measuring motion...');
        const mo = await measureClips(analyzed, { highlights: highlightRepo, motion: new MotionRepository(db) }, { cfg: config });
        console.log(`  Measured: ${mo.measured} clips, errors: ${mo.failed} (${mo.bands.locked} locked, ${mo.bands.stabilize} stabilize, ${mo.bands.shaky} shaky; ${mo.shakes.high} shakes, ${mo.shakes.low} low confidence)`);
        const fitProjects = [...new Set(analyzed.map((c) => c.project_id))].filter((id): id is number => id !== null);
        for (const projectId of fitProjects) {
          const fit = await runShakeFit(db, config, { projectId, clipIds: analyzed.map((c) => c.id) });
          console.log(`  Shake fit: ${shakeFitLine(fit.result)}`);
          if (fit.hint) console.error(chalk.yellow(fit.hint));
        }
      } catch (err) {
        bar.stop();
        throw err;
      } finally {
        db.close();
      }
    });
}
