import { Command } from 'commander';
import { writeFile } from 'node:fs/promises';
import chalk from 'chalk';
import { createDb } from '../../db/connection.js';
import { runMigrations } from '../../db/migrations/runner.js';
import { ClipRepository } from '../../db/repositories/clip.repository.js';
import { ProjectRepository } from '../../db/repositories/project.repository.js';
import { StoryboardService } from '../../core/storyboard/service.js';
import { cutToSegments } from '../../core/storyboard/export.js';
import { resolveProject } from './resolve-project.js';
import { resolveDbPath } from '../../utils/fs.js';
import { exportSegments } from '../../core/export/index.js';
import type { ExportFormat, ExportSegment } from '../../types/export.js';
import path from 'node:path';

/**
 * Derive the timeline fps from segments. All clips must share the same rate.
 * Returns the detected fps, or throws with a user-friendly message if mixed.
 */
function detectFps(
  segments: ExportSegment[],
  explicitFps: number | null,
  allowMixed = false,
): number {
  if (allowMixed) {
    // FCPXML and OTIO conform each clip to its own format; the timeline rate is --fps or the most common clip rate.
    if (explicitFps !== null) return explicitFps;
    const counts = new Map<number, number>();
    for (const s of segments) {
      if (s.fps > 0) counts.set(s.fps, (counts.get(s.fps) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!top) {
      throw new Error(
        'Could not detect frame rate from clips. Re-ingest the footage or pass --fps explicitly.',
      );
    }
    return top[0];
  }

  if (explicitFps !== null) {
    // Validate every clip matches the explicit rate (within 0.1 fps tolerance)
    const mismatched = segments.filter(
      s => s.fps > 0 && Math.abs(s.fps - explicitFps) > 0.1,
    );
    if (mismatched.length > 0) {
      const rates = [...new Set(mismatched.map(s => s.fps))].join(', ');
      throw new Error(
        `Mixed source frame rates detected: clips at ${rates} fps do not match --fps ${explicitFps}. ` +
        `All clips must share the same frame rate for export.`,
      );
    }
    return explicitFps;
  }

  const knownRates = segments.map(s => s.fps).filter(f => f > 0);
  if (knownRates.length === 0) {
    throw new Error(
      'Could not detect frame rate from clips. Re-ingest the footage or pass --fps explicitly.',
    );
  }

  const unique = [...new Set(knownRates.map(f => Math.round(f * 100) / 100))];
  if (unique.length > 1) {
    throw new Error(
      `Mixed source frame rates detected: ${unique.join(', ')} fps. ` +
      `Pass --fps to choose a timeline rate. All clips at other rates will be rejected.`,
    );
  }

  return unique[0];
}

export function registerExportCommand(parent: Command): void {
  parent
    .command('export')
    .description('Export a cut or clip list for DaVinci Resolve')
    .option('--cut [id]', 'Cut to export (no id: the cut "Main")')
    .option('--story [id]', 'Alias of --cut')
    .option('--project <name>', 'Project name for --cut without an id (default: the only project)')
    .option('--clips <ids>', 'Comma-separated clip IDs (e.g., 1,5,12)')
    .option('--format <format>', 'Export format: csv, json, edl, fcpxml, otio', 'edl')
    .option('--output <path>', 'Output file path')
    .option('--title <title>', 'Timeline title', 'ClipPilot Export')
    .option('--fps <fps>', 'Frame rate for timecode (auto-detected from clips if omitted)')
    .option('--json', 'Emit JSON confirmation (requires --output)')
    .action(async (options) => {
      const cutOpt: string | boolean | undefined = options.cut ?? options.story;
      if (cutOpt === undefined && !options.clips) {
        console.error(chalk.red('Error: Specify --cut [id] or --clips <id1,id2,...>'));
        process.exit(1);
      }

      const basePath = process.cwd();
      const db = createDb(resolveDbPath(basePath));
      runMigrations(db);

      try {
        let segments: ExportSegment[];
        const format = options.format as ExportFormat;
        const explicitFps = options.fps != null ? parseFloat(options.fps) : null;

        let skippedGaps: number | null = null;
        if (cutOpt !== undefined) {
          let cutId: number;
          if (typeof cutOpt === 'string') {
            cutId = parseInt(cutOpt, 10);
            if (!new StoryboardService(db).getCut(cutId)) {
              console.error(chalk.red(`Error: Cut ${cutOpt} not found`));
              process.exit(1);
            }
          } else {
            const project = resolveProject(new ProjectRepository(db), options.project);
            if (!project) process.exit(1);
            cutId = new StoryboardService(db).getOrCreateMainCut(project.id).id;
          }
          const built = cutToSegments(db, cutId, { fallbackFps: explicitFps });
          segments = built.segments;
          skippedGaps = built.skipped_gaps;
          if (segments.length === 0) {
            console.error(chalk.red(`Error: Cut ${cutId} has no filled panels to export (${skippedGaps} gap(s))`));
            process.exit(1);
          }
        } else {
          const clipIds = options.clips.split(',').map((s: string) => parseInt(s.trim(), 10));
          const clipRepo = new ClipRepository(db);
          const clips = clipRepo.findByIds(clipIds);

          if (clips.length === 0) {
            console.error(chalk.red('Error: No clips found with the specified IDs'));
            process.exit(1);
          }

          // Maintain the order specified by the user
          const clipMap = new Map(clips.map(c => [c.id, c]));
          segments = clipIds
            .filter((id: number) => clipMap.has(id))
            .map((id: number, idx: number) => {
              const clip = clipMap.get(id)!;
              return {
                position: idx + 1,
                clip_id: clip.id,
                file_path: clip.file_path,
                file_name: path.basename(clip.file_path),
                duration_sec: clip.duration_sec,
                start_sec: 0,
                end_sec: clip.duration_sec,
                start_timecode: clip.start_timecode ?? null,
                nb_frames: clip.nb_frames ?? null,
                fps: clip.fps ?? explicitFps ?? 0,
                has_video: clip.has_video !== 0,
                has_audio: clip.has_audio !== 0,
                resolution: clip.resolution,
                ai_summary: clip.ai_summary,
                segment_role: null,
                notes: null,
              };
            });
        }

        let fps: number;
        try {
          fps = detectFps(segments, explicitFps, format === 'fcpxml' || format === 'otio');
        } catch (err: any) {
          console.error(chalk.red(`Error: ${err.message}`));
          process.exit(1);
        }

        // Update all segment fps to the resolved timeline fps (for exporters that read options.fps)
        segments = segments.map(s => ({ ...s, fps: s.fps > 0 ? s.fps : fps }));

        if (!options.json) {
          console.log(chalk.dim(`Detected timeline rate: ${fps} fps`));
          if (format === 'edl') {
            console.log(
              chalk.yellow(
                `Note: Set DaVinci Resolve project frame rate to ${fps} fps before importing this EDL.`,
              ),
            );
          }
        }

        // Timeline frame size for FCPXML: the first clip's resolution.
        const res = segments.find(s => s.resolution)?.resolution?.match(/^(\d+)x(\d+)$/);
        const output = exportSegments(segments, {
          title: options.title,
          fps,
          width: res ? Number(res[1]) : undefined,
          height: res ? Number(res[2]) : undefined,
          format,
        });

        if (options.output) {
          await writeFile(options.output, output, 'utf-8');
          if (options.json) {
            console.log(
              JSON.stringify(
                {
                  ok: true,
                  path: path.resolve(options.output),
                  format,
                  fps,
                  count: segments.length,
                  ...(skippedGaps !== null ? { exported: segments.length, skipped_gaps: skippedGaps } : {}),
                },
                null,
                2,
              ),
            );
          } else {
            console.log(chalk.green(`Exported ${segments.length} segment(s) to ${options.output}`));
          }
        } else {
          console.log(output);
        }
      } finally {
        db.close();
      }
    });
}
