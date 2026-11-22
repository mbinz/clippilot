import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'node:fs';
import type Database from 'better-sqlite3';
import { createDb } from '../../db/connection.js';
import { runMigrations } from '../../db/migrations/runner.js';
import { ProjectRepository } from '../../db/repositories/project.repository.js';
import { resolveDbPath } from '../../utils/fs.js';
import { StoryboardService, type CutTree } from '../../core/storyboard/service.js';
import { isTier, TIERS } from '../../core/tiers.js';
import { resolveProject } from './resolve-project.js';

type Ctx = { db: Database.Database; svc: StoryboardService };

/** Open the DB, run the action, turn thrown errors into exit code 1. */
function withSvc(fn: (c: Ctx) => void): void {
  const db = createDb(resolveDbPath(process.cwd()));
  runMigrations(db);
  try {
    fn({ db, svc: new StoryboardService(db) });
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

const toId = (s: string): number => {
  const n = Number(s);
  if (!Number.isInteger(n)) throw new Error(`Invalid id "${s}"`);
  return n;
};
const toNum = (s: string, what = 'number'): number => {
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`Invalid ${what} "${s}"`);
  return n;
};
const print = (v: unknown) => console.log(JSON.stringify(v, null, 2));

/** Cut id from the argument, or the project's "Main" cut (created when missing). */
function cutIdOf({ db, svc }: Ctx, id: string | undefined, projectName?: string): number {
  if (id !== undefined) {
    const n = toId(id);
    if (!svc.getCut(n)) throw new Error(`Cut ${n} not found`);
    return n;
  }
  const project = resolveProject(new ProjectRepository(db), projectName);
  if (!project) throw new Error('Could not resolve the project');
  return svc.getOrCreateMainCut(project.id).id;
}

function projectIdOf(db: Database.Database, projectName?: string): number {
  const project = resolveProject(new ProjectRepository(db), projectName);
  if (!project) throw new Error('Could not resolve the project');
  return project.id;
}

function printTree(t: CutTree): void {
  const brief = t.brief_state === 'none' ? 'no brief' : `brief ${t.brief_state}`;
  console.log(`${chalk.bold(`Cut ${t.cut.id}: ${t.cut.name}`)}  (${brief})`);
  console.log(`  ${t.totals.panels} panels: ${t.totals.filled} filled, ${t.totals.candidates} candidates, ${t.totals.gaps} gaps, ${t.totals.duration_sec} s`);
  for (const s of t.scenes) {
    console.log(`${chalk.cyan(`Scene ${s.id}`)} ${s.name}${s.event ? chalk.dim(` [event: ${s.event.name}]`) : ''}`);
    for (const p of s.panels) {
      const what = p.state === 'filled' ? `clip ${p.clip_id} ${p.start_sec}-${p.end_sec} x${p.speed}`
        : p.state === 'candidates' ? `candidates ${p.candidates.map((c) => c.id).join(',')}` : 'gap';
      console.log(`  ${String(p.id).padStart(3)}  ${p.intent}  ${chalk.dim(`${what} (${p.source})`)}`);
    }
  }
}

const projectOpt = ['--project <name>', 'Project name (default: the only project)'] as const;

export function registerCutCommands(parent: Command): void {
  // ---------- cut ----------
  const cut = parent.command('cut').description('Cuts: the storyboard (scenes and panels) of a film');

  cut.command('list')
    .description("List the project's cuts")
    .option(...projectOpt)
    .option('--json', 'Emit JSON')
    .action((o) => withSvc(({ db, svc }) => {
      const cuts = svc.listCuts(projectIdOf(db, o.project)).map((c) => ({ id: c.id, name: c.name, brief_state: c.brief_state }));
      if (o.json) return print(cuts);
      if (cuts.length === 0) return console.log('No cuts yet. "clippilot cut show" creates "Main".');
      for (const c of cuts) console.log(`${String(c.id).padStart(3)}  ${c.name}  (${c.brief_state === 'none' ? 'no brief' : `brief ${c.brief_state}`})`);
    }));

  cut.command('create <name>')
    .description('Create a cut')
    .option(...projectOpt)
    .action((name: string, o) => withSvc(({ db, svc }) => {
      print(svc.createCut(projectIdOf(db, o.project), name));
    }));

  cut.command('show [id]')
    .description('Show a cut as a tree (default: the cut "Main")')
    .option(...projectOpt)
    .option('--json', 'Emit JSON')
    .action((id: string | undefined, o) => withSvc((c) => {
      const tree = c.svc.getCut(cutIdOf(c, id, o.project))!;
      if (o.json) print(tree);
      else printTree(tree);
    }));

  cut.command('rename <id> <name>')
    .description('Rename a cut')
    .action((id: string, name: string) => withSvc(({ svc }) => {
      svc.renameCut(toId(id), name);
      print(svc.getCut(toId(id))!.cut);
    }));

  cut.command('delete <id>')
    .description('Delete a cut with its scenes and panels')
    .action((id: string) => withSvc(({ svc }) => {
      if (!svc.getCut(toId(id))) throw new Error(`Cut ${id} not found`);
      svc.deleteCut(toId(id));
      print({ ok: true, deleted: toId(id) });
    }));

  cut.command('brief [id]')
    .description('Print the brief; --set-file stores it as proposed; --confirm marks it confirmed (after the user agreed)')
    .option('--set-file <file>', 'JSON file with the brief')
    .option('--confirm', 'Mark the brief as confirmed')
    .option(...projectOpt)
    .option('--json', 'Emit JSON (output is always JSON)')
    .action((id: string | undefined, o) => withSvc((c) => {
      const cutId = cutIdOf(c, id, o.project);
      if (o.setFile) {
        let raw: unknown;
        try {
          raw = JSON.parse(fs.readFileSync(o.setFile, 'utf-8'));
        } catch (err) {
          throw new Error(`Cannot read brief file ${o.setFile}: ${(err as Error).message}`);
        }
        c.svc.setBrief(cutId, raw, o.confirm ? 'confirmed' : 'proposed');
      } else if (o.confirm) {
        const cur = c.svc.getCut(cutId)!;
        if (cur.brief === null) throw new Error('No brief to confirm. Set one first with --set-file');
        c.svc.setBrief(cutId, cur.brief, 'confirmed');
      }
      const t = c.svc.getCut(cutId)!;
      print({ cut_id: cutId, brief: t.brief, brief_state: t.brief_state });
    }));

  cut.command('apply [id]')
    .description('Apply a draft JSON (scenes and panels) to a cut; replaces AI panels unless --append')
    .requiredOption('--file <file>', 'Draft JSON file')
    .option('--append', 'Add the draft scenes at the end instead of replacing', false)
    .option(...projectOpt)
    .action((id: string | undefined, o) => withSvc((c) => {
      let raw: unknown;
      try {
        raw = JSON.parse(fs.readFileSync(o.file, 'utf-8'));
      } catch (err) {
        throw new Error(`Cannot read draft file ${o.file}: ${(err as Error).message}`);
      }
      const cutId = cutIdOf(c, id, o.project);
      const res = c.svc.applyDraft(cutId, raw, { mode: o.append ? 'append' : 'replace' });
      print({ cut_id: cutId, ...res });
    }));

  // ---------- scene ----------
  const scene = parent.command('scene').description('Scenes of a cut');

  scene.command('add <name>')
    .description('Add a scene (default: at the end of the cut "Main")')
    .option('--cut <id>', 'Cut id')
    .option('--at <position>', 'Position (default: end)')
    .option(...projectOpt)
    .action((name: string, o) => withSvc((c) => {
      const cutId = cutIdOf(c, o.cut, o.project);
      print(c.svc.addScene(cutId, name, { position: o.at === undefined ? undefined : toNum(o.at, 'position') }));
    }));

  scene.command('rename <id> <name>')
    .description('Rename a scene')
    .action((id: string, name: string) => withSvc(({ svc }) => {
      svc.renameScene(toId(id), name);
      print({ ok: true, id: toId(id), name });
    }));

  scene.command('move <id> <position>')
    .description('Move a scene to a position (0 = first)')
    .action((id: string, position: string) => withSvc(({ svc }) => {
      svc.moveScene(toId(id), toNum(position, 'position'));
      print({ ok: true, id: toId(id) });
    }));

  scene.command('delete <id>')
    .description('Delete a scene with its panels')
    .action((id: string) => withSvc(({ svc }) => {
      svc.deleteScene(toId(id));
      print({ ok: true, deleted: toId(id) });
    }));

  scene.command('set-event <id> <eventId>')
    .description('Link a scene to an event ("none" clears it)')
    .action((id: string, eventId: string) => withSvc(({ db, svc }) => {
      const ev = eventId === 'none' ? null : toId(eventId);
      if (ev !== null && !db.prepare('SELECT 1 FROM events WHERE id = ?').get(ev)) throw new Error(`Event ${ev} not found`);
      svc.setSceneEvent(toId(id), ev);
      print({ ok: true, id: toId(id), event_id: ev });
    }));

  // ---------- panel ----------
  const panel = parent.command('panel').description('Panels of a scene');

  panel.command('add <sceneId>')
    .description('Add a panel: a gap, filled from --moment, or with --candidates')
    .option('--intent <text>', 'What the shot should show', '')
    .option('--moment <id>', 'Fill from this moment')
    .option('--candidates <ids>', 'Comma-separated candidate moment ids')
    .option('--at <position>', 'Position (default: end)')
    .action((sceneId: string, o) => withSvc(({ svc }) => {
      print(svc.addPanel(toId(sceneId), {
        intent: o.intent,
        momentId: o.moment === undefined ? undefined : toId(o.moment),
        candidates: o.candidates === undefined ? undefined : String(o.candidates).split(',').map((s) => toId(s.trim())),
        source: 'user',
      }, o.at === undefined ? undefined : toNum(o.at, 'position')));
    }));

  panel.command('move <id> <sceneId> <position>')
    .description('Move a panel to a scene and position')
    .action((id: string, sceneId: string, position: string) => withSvc(({ svc }) => {
      svc.movePanel(toId(id), toId(sceneId), toNum(position, 'position'));
      print({ ok: true, id: toId(id), scene_id: toId(sceneId) });
    }));

  panel.command('delete <id>')
    .description('Delete a panel')
    .action((id: string) => withSvc(({ svc }) => {
      svc.deletePanel(toId(id));
      print({ ok: true, deleted: toId(id) });
    }));

  panel.command('intent <id> <text>')
    .description("Set a panel's intent")
    .action((id: string, text: string) => withSvc(({ svc }) => {
      svc.setIntent(toId(id), text);
      print({ ok: true, id: toId(id), intent: text });
    }));

  panel.command('trim <id> <start> <end>')
    .description('Set in/out seconds of a filled panel (clamped to the clip)')
    .action((id: string, start: string, end: string) => withSvc(({ svc }) => {
      svc.trimPanel(toId(id), toNum(start, 'start'), toNum(end, 'end'));
      print({ ok: true, id: toId(id) });
    }));

  panel.command('speed <id> <speed>')
    .description('Set playback speed: 1, 0.5 or 0.25 (needs enough source fps)')
    .action((id: string, speed: string) => withSvc(({ svc }) => {
      svc.setSpeed(toId(id), toNum(speed, 'speed'));
      print({ ok: true, id: toId(id), speed: toNum(speed) });
    }));

  panel.command('place <panelId> <momentId>')
    .description('Put a moment on a panel (confirms the moment)')
    .action((panelId: string, momentId: string) => withSvc(({ svc }) => {
      svc.placeMoment(toId(panelId), toId(momentId));
      print({ ok: true, panel_id: toId(panelId), moment_id: toId(momentId) });
    }));

  panel.command('pick <panelId> <momentId>')
    .description('Pick one candidate of a panel (same as place)')
    .action((panelId: string, momentId: string) => withSvc(({ svc }) => {
      svc.pickCandidate(toId(panelId), toId(momentId));
      print({ ok: true, panel_id: toId(panelId), moment_id: toId(momentId) });
    }));

  // ---------- moment / moments ----------
  parent.command('moment').description('Moment decisions')
    .command('reject <id>')
    .description('Reject a moment (it leaves candidate lists; a panel using it becomes a gap)')
    .option('--reason <text>', 'Why')
    .action((id: string, o) => withSvc(({ svc }) => {
      svc.rejectMoment(toId(id), o.reason);
      print({ ok: true, id: toId(id), status: 'rejected' });
    }));

  parent.command('moments').description('Moments for drafting')
    .command('list')
    .description('List moments as compact rows (hidden clips excluded)')
    .option('--event <id>', 'Only moments of clips in this event')
    .option('--min-tier <tier>', `Only moments at or above this tier: ${TIERS.join(', ')}`)
    .option('--include-rejected', 'Include rejected moments', false)
    .option(...projectOpt)
    .option('--json', 'Emit JSON')
    .action((o) => withSvc(({ db, svc }) => {
      if (o.minTier !== undefined && !isTier(o.minTier)) throw new Error(`Invalid --min-tier "${o.minTier}". Use: ${TIERS.join(', ')}`);
      const rows = svc.listMoments(projectIdOf(db, o.project), {
        eventId: o.event === undefined ? undefined : toId(o.event),
        minTier: o.minTier,
        includeRejected: o.includeRejected,
      });
      if (o.json) return print(rows);
      for (const r of rows) {
        console.log(`${String(r.id).padStart(4)}  clip ${r.clip_id}  ${r.start_sec}-${r.end_sec}  ${r.tier}  ${r.status}  ${r.description}`);
      }
    }));

  // ---------- clip ----------
  const clip = parent.command('clip').description('Clip visibility');
  clip.command('hide <id>')
    .description('Hide a clip: its moments leave panels and candidate lists')
    .action((id: string) => withSvc(({ svc }) => {
      svc.hideClip(toId(id));
      print({ ok: true, id: toId(id), hidden: true });
    }));
  clip.command('unhide <id>')
    .description('Unhide a clip (panels it left stay gaps)')
    .action((id: string) => withSvc(({ svc }) => {
      svc.unhideClip(toId(id));
      print({ ok: true, id: toId(id), hidden: false });
    }));
}
