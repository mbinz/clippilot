import { Command } from 'commander';
import chalk from 'chalk';
import { createDb } from '../../db/connection.js';
import { runMigrations } from '../../db/migrations/runner.js';
import { ClipRepository } from '../../db/repositories/clip.repository.js';
import { ProjectRepository } from '../../db/repositories/project.repository.js';
import { HighlightRepository } from '../../db/repositories/highlight.repository.js';
import { TranscriptRepository } from '../../db/repositories/transcript.repository.js';
import { resolveDbPath } from '../../utils/fs.js';
import { loadConfig } from '../../core/config/manager.js';
import { transcribeClips, requireWhisperModel, resolveVadModel, vadMissingWarning } from '../../core/transcribe/index.js';
import { resolveProject } from './resolve-project.js';

export function registerTranscribeCommand(parent: Command): void {
  parent
    .command('transcribe')
    .description('Transcribe spoken words of clips (whisper.cpp) and snap unprotected moments to whole sentences')
    .option('--project <name>', 'Project name (default: the only project)')
    .option('--force', 'Redo clips that already have a transcript', false)
    .option('--json', 'Emit JSON (progress lines go to stderr)')
    .action(async (options) => {
      const basePath = process.cwd();
      const config = await loadConfig(basePath);
      let model: string;
      try {
        model = requireWhisperModel(config);
      } catch (err) {
        console.error(chalk.red((err as Error).message));
        process.exitCode = 1;
        return;
      }

      const vadModel = resolveVadModel(config);
      if (!vadModel) console.error(chalk.yellow(vadMissingWarning(config)));

      const db = createDb(resolveDbPath(basePath));
      try {
        runMigrations(db);
        const project = resolveProject(new ProjectRepository(db), options.project);
        if (!project) return;
        const clips = new ClipRepository(db).listByProject(project.id).filter((c) => !c.hidden);
        const log = options.json ? console.error : console.log;
        const result = await transcribeClips(
          clips,
          { transcripts: new TranscriptRepository(db), highlights: new HighlightRepository(db) },
          { model, vadModel, languages: config.languages, force: options.force, onProgress: (done, total, name) => log(`[${done}/${total}] ${name}`) },
        );
        if (options.json) {
          console.log(JSON.stringify({ project: project.name, model, ...result }, null, 2));
        } else {
          console.log(`Transcribed ${result.transcribed}, skipped ${result.skipped_existing} (already done) + ${result.skipped_no_audio} (no audio), `
            + `${result.errors.length} failed; ${result.snapped} moments snapped to sentences.`);
          if (result.dropped_language > 0) console.log(`  ${result.dropped_language} clips dropped (language not in ${config.languages.join(', ')}).`);
          const dropped = Object.entries(result.dropped_segments);
          if (dropped.length) console.log(`  Dropped segments: ${dropped.map(([r, n]) => `${r} ${n}`).join(', ')}.`);
          for (const e of result.errors) console.error(chalk.red(`  clip ${e.clip_id}: ${e.message}`));
        }
        if (result.errors.length > 0) process.exitCode = 1;
      } finally {
        db.close();
      }
    });
}
