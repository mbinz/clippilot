import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { createDb } from '../../db/connection.js';
import { runMigrations } from '../../db/migrations/runner.js';
import { ProjectRepository } from '../../db/repositories/project.repository.js';
import { HighlightRepository } from '../../db/repositories/highlight.repository.js';
import { resolveClippilotDir, resolveDbPath } from '../../utils/fs.js';
import { loadConfig } from '../../core/config/manager.js';
import { StoryboardService } from '../../core/storyboard/service.js';
import { ReviewStore, RESOLUTIONS, panelLabels, parseFindings, type Resolution } from '../../core/critic/findings.js';
import { buildContext } from '../../core/critic/context.js';
import { buildStoryPrompt, createGeminiStoryClient, runStoryCritic, type StoryCriticClient } from '../../core/critic/story-critic.js';
import { estimateCost, previewDuration, previewSegments, renderPreview, type FfmpegRunner } from '../../core/critic/preview.js';
import { resolveProject } from './resolve-project.js';

export interface CriticInject {
  /** Story critic model client (default: Gemini via the Files API). */
  client?: StoryCriticClient;
  /** ffmpeg runner for the preview render. */
  render?: FfmpegRunner;
}

interface Ctx { db: Database.Database; svc: StoryboardService; hl: HighlightRepository; store: ReviewStore; base: string }

const print = (v: unknown) => console.log(JSON.stringify(v, null, 2));

async function withCtx(fn: (c: Ctx) => void | Promise<void>): Promise<void> {
  const base = process.cwd();
  const db = createDb(resolveDbPath(base));
  try {
    runMigrations(db);
    await fn({ db, svc: new StoryboardService(db), hl: new HighlightRepository(db), store: new ReviewStore(path.join(resolveClippilotDir(base), 'reviews')), base });
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

/** --cut id, else the project's "Main" cut. */
function cutIdOf(c: Ctx, cut?: string, projectName?: string): number {
  if (cut !== undefined) {
    const n = Number(cut);
    if (!Number.isInteger(n) || !c.svc.getCut(n)) throw new Error(`Cut "${cut}" not found`);
    return n;
  }
  const project = resolveProject(new ProjectRepository(c.db), projectName);
  if (!project) throw new Error('Could not resolve the project');
  return c.svc.getOrCreateMainCut(project.id).id;
}

const cutOpt = ['--cut <id>', 'Cut id (default: the cut "Main")'] as const;
const projectOpt = ['--project <name>', 'Project name (default: the only project)'] as const;

export function registerCriticCommands(parent: Command, inject: CriticInject = {}): void {
  const critic = parent.command('critic').description('Review loop plumbing: findings, cut-critic context, story critic');

  critic.command('save')
    .description('Validate and store a critic\'s findings file (ids must exist in the cut; protected is recomputed)')
    .requiredOption('--file <path>', 'Findings JSON written by a critic')
    .option('--json', 'Emit JSON')
    .action((o) => withCtx((c) => {
      let raw: unknown;
      try { raw = JSON.parse(fs.readFileSync(o.file, 'utf-8')); } catch (err) { throw new Error(`Cannot read ${o.file}: ${(err as Error).message}`); }
      const cutId = (raw as { cut_id?: unknown })?.cut_id;
      const tree = typeof cutId === 'number' ? c.svc.getCut(cutId) : null;
      if (!tree) throw new Error(`Cut ${String(cutId)} not found`);
      const r = parseFindings(raw, tree, c.hl);
      if (!r.file) throw new Error(`Invalid findings:\n${r.errors.map((e) => `  ${e}`).join('\n')}`);
      const saved = c.store.save(r.file);
      const result = {
        file: saved.file, path: saved.path, critic: r.file.critic, cut_id: r.file.cut_id, round: r.file.round,
        findings: r.file.findings.length, protected: r.file.findings.filter((f) => f.protected).length,
      };
      if (o.json) print(result);
      else console.log(`Saved ${saved.file}: ${result.findings} findings (${result.protected} protected)`);
    }));

  critic.command('list')
    .description('List stored reviews, newest first')
    .option(...cutOpt).option(...projectOpt)
    .option('--json', 'Emit JSON')
    .action((o) => withCtx((c) => {
      const cutId = cutIdOf(c, o.cut, o.project);
      const rows = c.store.list(cutId).map(({ file, review }) => ({
        file, critic: review.critic, cut_id: review.cut_id, round: review.round, saved_at: review.saved_at,
        findings: review.findings.length,
        open: review.findings.filter((f) => !review.resolutions[f.id]).length,
      }));
      if (o.json) return print(rows);
      if (rows.length === 0) return console.log('No reviews yet.');
      for (const r of rows) console.log(`${r.file}  ${r.critic} round ${r.round}: ${r.findings} findings, ${r.open} open`);
    }));

  critic.command('show <file>')
    .description('Show a stored review with its resolutions (a file name, a path, or "latest")')
    .option('--json', 'Emit JSON (output is always JSON)')
    .action((file: string) => withCtx((c) => {
      const review = c.store.load(file);
      const tree = c.svc.getCut(review.cut_id);
      // `position` in a proposal is 1-based; `panel move` takes 0-based. Derived here so the loop cannot get it wrong.
      const findings = review.findings.map((f) => {
        const pr = f.proposal;
        if (pr?.position !== undefined) return { ...f, cli_position: pr.position - 1 };
        if (f.kind === 'move_scene' && pr?.to_scene_id !== undefined) {
          const target = tree?.scenes.find((s) => s.id === pr.to_scene_id);
          if (target) return { ...f, cli_position: target.panels.length };
        }
        return f;
      });
      print({ ...review, findings });
    }));

  critic.command('resolve <file> <finding> <resolution>')
    .description(`Record what happened to a finding: ${RESOLUTIONS.join(' | ')}`)
    .option('--note <text>', 'What was done / why')
    .action((file: string, finding: string, resolution: string, o) => withCtx((c) => {
      const review = c.store.resolve(file, finding, resolution as Resolution, o.note);
      print({ ok: true, finding, resolution: review.resolutions[finding] });
    }));

  critic.command('summary')
    .description('Per round: findings by severity and resolution, plus the applied changes one line each')
    .option(...cutOpt).option(...projectOpt)
    .option('--json', 'Emit JSON')
    .action((o) => withCtx((c) => {
      const cutId = cutIdOf(c, o.cut, o.project);
      const labels = panelLabels(c.svc.getCut(cutId)!);
      const rounds = c.store.summary(cutId, labels);
      if (o.json) return print({ cut_id: cutId, rounds });
      if (rounds.length === 0) return console.log('No reviews yet.');
      for (const r of rounds) {
        console.log(`Round ${r.round}: ${r.findings} findings (must ${r.by_severity.must}, should ${r.by_severity.should}, nit ${r.by_severity.nit}); `
          + `applied ${r.by_resolution.applied}, skipped ${r.by_resolution.skipped}, protected ${r.by_resolution.protected}, open ${r.by_resolution.open}`);
        for (const line of r.applied) console.log(`  - ${line}`);
      }
    }));

  critic.command('context')
    .description('Write what the cut critic needs: the brief, every panel (moment, protection, neighbours) and one still strip per panel')
    .option(...cutOpt).option(...projectOpt)
    .requiredOption('--out <dir>', 'Directory for context.json and strips/panel-<id>.png')
    .option('--json', 'Emit JSON (output is always JSON)')
    .action((o) => withCtx(async (c) => {
      print(await buildContext(c.svc, c.hl, cutIdOf(c, o.cut, o.project), path.resolve(o.out), { db: c.db }));
    }));

  critic.command('story')
    .description('Story critic: render a 480p preview of the cut and have gemini-3.1-pro-preview review it. Without --yes only prints the cost estimate (exit 2)')
    .option(...cutOpt).option(...projectOpt)
    .option('--yes', 'Spend the money: upload the preview and run the review', false)
    .option('--round <n>', 'Review round recorded in the findings', '1')
    .option('--json', 'Emit JSON')
    .action((o) => withCtx(async (c) => {
      const cutId = cutIdOf(c, o.cut, o.project);
      const tree = c.svc.getCut(cutId)!;
      const clipStmt = c.db.prepare('SELECT file_path, proxy_path, has_audio FROM clips WHERE id = ?');
      const segs = previewSegments(tree, (id) => {
        const r = clipStmt.get(id) as { file_path: string; proxy_path: string | null; has_audio: number } | undefined;
        return r ? { file: r.proxy_path ?? r.file_path, hasAudio: r.has_audio === 1 } : null;
      });
      const previewPath = path.join(resolveClippilotDir(c.base), 'previews', `cut-${cutId}.mp4`);
      await renderPreview(segs, previewPath, inject.render);
      const prompt = buildStoryPrompt(tree);
      const duration = previewDuration(segs);
      const est = estimateCost({ duration_sec: duration, prompt_chars: prompt.system.length + prompt.user.length });
      const config = await loadConfig(c.base);
      const base = { cut_id: cutId, preview: previewPath, duration_sec: duration, model: config.story_critic_model, ...est };

      if (!o.yes) {
        process.exitCode = 2;
        if (o.json) return print({ estimate_usd: est.estimate_usd, duration_sec: duration, preview: previewPath, model: config.story_critic_model });
        console.log(`Preview ${previewPath} (${duration} s). Estimated cost with ${config.story_critic_model}: $${est.estimate_usd.toFixed(2)}. Run again with --yes to spend it.`);
        return;
      }
      const client = inject.client ?? (() => {
        if (!config.gemini_api_key) throw new Error('Gemini API key not configured (clippilot config set gemini_api_key <key> or GEMINI_API_KEY).');
        return createGeminiStoryClient(config.gemini_api_key);
      })();
      const round = Number(o.round);
      if (!Number.isInteger(round) || round < 1) throw new Error(`Invalid round "${o.round}"`);
      let findings;
      try {
        findings = await runStoryCritic({ client, model: config.story_critic_model, preview: previewPath, tree, hl: c.hl, round });
      } catch (e) {
        const err = e as { status?: number; code?: number; message?: string };
        const msg = err.message ?? String(e);
        if (err.status === 404 || err.code === 404 || /\b404\b|not found|no longer available/i.test(msg)) {
          throw new Error(`Story critic model "${config.story_critic_model}" was not found or is unavailable (${msg}). Set another model with story_critic_model in the config (clippilot config set story_critic_model <model>).`);
        }
        throw e;
      }
      const saved = c.store.save(findings);
      const result = { ...base, file: saved.file, round, findings: findings.findings.length, protected: findings.findings.filter((f) => f.protected).length };
      if (o.json) print(result);
      else console.log(`Saved ${saved.file}: ${result.findings} findings (${result.protected} protected)`);
    }));
}
