import { Command } from 'commander';
import chalk from 'chalk';
import type Database from 'better-sqlite3';
import { createDb } from '../../db/connection.js';
import { runMigrations } from '../../db/migrations/runner.js';
import { ProjectRepository } from '../../db/repositories/project.repository.js';
import { resolveDbPath } from '../../utils/fs.js';
import { loadConfig } from '../../core/config/manager.js';
import { StoryboardService } from '../../core/storyboard/service.js';
import { fixShakes, type FixResult, type ShakeVerifier } from '../../core/shakes/index.js';
import { createGeminiShakeVerifier } from '../../core/shakes/verify.js';
import type { AppConfig } from '../../types/config.js';
import { resolveProject } from './resolve-project.js';

export interface ShakesInject {
  /** The AI check (default: Gemini with `gemini_model`; none without an API key). */
  verifier?: ShakeVerifier;
  exists?: (p: string) => boolean;
}

export const NO_KEY_HINT = (n: number): string =>
  `No Gemini API key: ${n} trim/split plan${n === 1 ? ' was' : 's were'} not applied (no change without the AI check). `
  + 'Set GEMINI_API_KEY or run: clippilot config set gemini_api_key <key>, then: clippilot shakes fix';

/** Shared by `shakes fix`, `motion` and `analyze`: run the shake fit with the configured AI check. Returns the result and a hint, if any. */
export async function runShakeFit(
  db: Database.Database, config: AppConfig, o: { projectId: number; cutId?: number; clipIds?: number[]; dryRun?: boolean }, inject: ShakesInject = {},
): Promise<{ result: FixResult; hint: string | null }> {
  const verifier = inject.verifier ?? (config.gemini_api_key ? createGeminiShakeVerifier(config.gemini_api_key, config.gemini_model) : null);
  const result = await fixShakes(db, { ...o, verifier, exists: inject.exists });
  const hint = !o.dryRun && !verifier && result.totals.unverified > 0 ? NO_KEY_HINT(result.totals.unverified) : null;
  return { result, hint };
}

export function shakeFitLine(r: FixResult): string {
  const t = r.totals;
  return `${t.checked} moments checked: ${t.fixed} fixed (${t.new_moments} new moments), ${t.kept} kept, ${t.clean} clean`
    + `${t.unverified ? `, ${t.unverified} not decided` : ''}${t.errors ? `, ${t.errors} errors` : ''}; ${t.skipped} already checked, ${t.gemini_calls} Gemini calls.`;
}

export function registerShakesCommands(parent: Command, inject: ShakesInject = {}): void {
  const shakes = parent.command('shakes').description('Shake fit: trim or split moments around camera shakes (AI-checked), or mark them kept');
  shakes
    .command('fix')
    .description('Plan the shake fit for every unprotected moment, check it with Gemini Flash, then trim / split or mark kept (one undo step per cut)')
    .option('--project <name>', 'Project name (default: the only project)')
    .option('--cut <id>', 'Only the moments used by this cut')
    .option('--dry-run', 'Plans only: no Gemini call, nothing written', false)
    .option('--json', 'Emit JSON')
    .action(async (options) => {
      const basePath = process.cwd();
      const config = await loadConfig(basePath);
      const db = createDb(resolveDbPath(basePath));
      try {
        runMigrations(db);
        let projectId: number;
        let cutId: number | undefined;
        if (options.cut !== undefined) {
          const svc = new StoryboardService(db);
          const n = Number(options.cut);
          if (!Number.isInteger(n) || !svc.getCut(n)) throw new Error(`Cut "${options.cut}" not found`);
          cutId = n;
          projectId = svc.projectIdOfCut(n);
        } else {
          const project = resolveProject(new ProjectRepository(db), options.project);
          if (!project) return;
          projectId = project.id;
        }
        const { result, hint } = await runShakeFit(db, config, { projectId, cutId, dryRun: options.dryRun }, inject);
        if (options.json) {
          console.log(JSON.stringify({ dry_run: Boolean(options.dryRun), ...result, hint }, null, 2));
        } else {
          for (const m of result.moments) {
            const parts = m.plan.kind === 'trim' || m.plan.kind === 'split' ? ' -> ' + m.plan.parts.map((p) => `${p.start}-${p.end}`).join(' + ') : '';
            console.log(`  moment ${m.moment_id}: ${m.plan.kind}${parts}${m.status ? ` [${m.status}]` : ''}${m.reason ? ` ${m.reason}` : ''}${m.error ? chalk.red(` ERROR ${m.error}`) : ''}`);
          }
          console.log(`${options.dryRun ? 'Dry run: ' : ''}${shakeFitLine(result)}`);
        }
        if (hint) console.error(chalk.yellow(hint));
        if (result.totals.errors > 0) process.exitCode = 1;
      } catch (err) {
        console.error((err as Error).message);
        process.exitCode = 1;
      } finally {
        db.close();
      }
    });
}
