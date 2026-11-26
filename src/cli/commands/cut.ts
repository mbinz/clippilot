import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'node:fs';
import type Database from 'better-sqlite3';
import { createDb } from '../../db/connection.js';
import { runMigrations } from '../../db/migrations/runner.js';
import { ProjectRepository } from '../../db/repositories/project.repository.js';
import { resolveDbPath } from '../../utils/fs.js';
import { StoryboardService, type CutTree } from '../../core/storyboard/service.js';
import { labels } from '../../core/storyboard/labels.js';
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

/** Cut a moment/clip edit is logged on: --cut, else the "Main" cut of the item's project. */
function logCutOf(svc: StoryboardService, cut: string | undefined, projectId: number): number {
  if (cut === undefined) return svc.getOrCreateMainCut(projectId).id;
  const n = toId(cut);
  if (svc.projectIdOfCut(n) !== projectId) throw new Error(`Cut ${n} belongs to another project`);
  return n;
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

const AI = { actor: 'ai' } as const;
/** Logged actor of an edit verb: `ai` with --ai (Claude in the review loop), else the user. */
const actorOf = (o: { ai?: boolean }) => (o.ai ? AI : undefined);
const aiFlag = ['--ai', 'Edit by Claude (review loop): logged as an AI edit in the history', false] as const;

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
    .action((id: string, name: string, o) => withSvc(({ svc }) => {
      svc.command(toId(id), labels.renameCut(name), () => svc.renameCut(toId(id), name));
      print(svc.getCut(toId(id))!.cut);
    }));

  cut.command('delete <id>')
    .description('Delete a cut with its scenes and panels')
    .action((id: string) => withSvc(({ svc }) => {
      if (!svc.getCut(toId(id))) throw new Error(`Cut ${id} not found`);
      svc.deleteCut(toId(id));
      print({ ok: true, deleted: toId(id) });
    }));

  for (const [name, desc] of [['undo', 'Undo the last change to a cut'], ['redo', 'Redo the last undone change']] as const) {
    cut.command(`${name} [id]`)
      .description(`${desc} (default: the cut "Main")`)
      .option(...projectOpt)
      .option('--json', 'Emit JSON (output is always JSON)')
      .action((id: string | undefined, o) => withSvc((c) => {
        const cutId = cutIdOf(c, id, o.project);
        const r = name === 'undo' ? c.svc.undo(cutId) : c.svc.redo(cutId);
        print({ cut_id: cutId, ...r, ...c.svc.historyState(cutId) });
      }));
  }

  cut.command('history [id]')
    .description('List the last 50 changes to a cut, newest first (default: the cut "Main")')
    .option(...projectOpt)
    .option('--json', 'Emit JSON')
    .action((id: string | undefined, o) => withSvc((c) => {
      const h = c.svc.history(cutIdOf(c, id, o.project));
      if (o.json) return print(h);
      if (h.length === 0) return console.log('No changes yet.');
      for (const op of h) console.log(`${String(op.id).padStart(4)}  ${op.undone ? chalk.dim('(undone) ') : ''}${op.label}  ${chalk.dim(op.created_at)}`);
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
        const state = o.confirm ? 'confirmed' : 'proposed';
        c.svc.command(cutId, labels.brief(state), () => c.svc.setBrief(cutId, raw, state));
      } else if (o.confirm) {
        const cur = c.svc.getCut(cutId)!;
        if (cur.brief === null) throw new Error('No brief to confirm. Set one first with --set-file');
        c.svc.command(cutId, labels.brief('confirmed'), () => c.svc.setBrief(cutId, cur.brief, 'confirmed'));
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
      const res = c.svc.command(cutId, labels.applyDraft(raw), () => c.svc.applyDraft(cutId, raw, { mode: o.append ? 'append' : 'replace' }), AI);
      print({ cut_id: cutId, ...res });
    }));

  // ---------- scene ----------
  const scene = parent.command('scene').description('Scenes of a cut');

  scene.command('add <name>')
    .description('Add a scene (default: at the end of the cut "Main")')
    .option('--cut <id>', 'Cut id')
    .option('--at <position>', 'Position (default: end)')
    .option(...projectOpt)
    .option(...aiFlag)
    .action((name: string, o) => withSvc((c) => {
      const cutId = cutIdOf(c, o.cut, o.project);
      const position = o.at === undefined ? undefined : toNum(o.at, 'position');
      print(c.svc.command(cutId, labels.addScene(name), () => c.svc.addScene(cutId, name, { position }), actorOf(o)));
    }));

  scene.command('rename <id> <name>')
    .description('Rename a scene')
    .option(...aiFlag)
    .action((id: string, name: string, o) => withSvc(({ svc }) => {
      svc.command(svc.cutIdOfScene(toId(id)), labels.renameScene(name), () => svc.renameScene(toId(id), name), actorOf(o));
      print({ ok: true, id: toId(id), name });
    }));

  scene.command('move <id> <position>')
    .description('Move a scene to a position (0 = first)')
    .option(...aiFlag)
    .action((id: string, position: string, o) => withSvc(({ svc }) => {
      svc.command(svc.cutIdOfScene(toId(id)), labels.moveScene(svc, toId(id)), () => svc.moveScene(toId(id), toNum(position, 'position')), actorOf(o));
      print({ ok: true, id: toId(id) });
    }));

  scene.command('delete <id>')
    .description('Delete a scene with its panels')
    .option(...aiFlag)
    .action((id: string, o) => withSvc(({ svc }) => {
      svc.command(svc.cutIdOfScene(toId(id)), labels.deleteScene(svc, toId(id)), () => svc.deleteScene(toId(id)), actorOf(o));
      print({ ok: true, deleted: toId(id) });
    }));

  scene.command('set-event <id> <eventId>')
    .description('Link a scene to an event ("none" clears it)')
    .option(...aiFlag)
    .action((id: string, eventId: string, o) => withSvc(({ db, svc }) => {
      const ev = eventId === 'none' ? null : toId(eventId);
      if (ev !== null && !db.prepare('SELECT 1 FROM events WHERE id = ?').get(ev)) throw new Error(`Event ${ev} not found`);
      svc.command(svc.cutIdOfScene(toId(id)), labels.sceneEvent(svc, toId(id)), () => svc.setSceneEvent(toId(id), ev), actorOf(o));
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
    .option(...aiFlag)
    .action((sceneId: string, o) => withSvc(({ svc }) => {
      const input = {
        intent: o.intent,
        momentId: o.moment === undefined ? undefined : toId(o.moment),
        candidates: o.candidates === undefined ? undefined : String(o.candidates).split(',').map((s) => toId(s.trim())),
        source: 'user' as const,
      };
      const at = o.at === undefined ? undefined : toNum(o.at, 'position');
      print(svc.command(svc.cutIdOfScene(toId(sceneId)), labels.addPanel(svc, toId(sceneId)), () => svc.addPanel(toId(sceneId), input, at), actorOf(o)));
    }));

  panel.command('move <id> <sceneId> <position>')
    .description('Move a panel to a scene and position')
    .option(...aiFlag)
    .action((id: string, sceneId: string, position: string, o) => withSvc(({ svc }) => {
      svc.command(svc.cutIdOfPanel(toId(id)), labels.movePanel(svc, toId(id)), () => svc.movePanel(toId(id), toId(sceneId), toNum(position, 'position')), actorOf(o));
      print({ ok: true, id: toId(id), scene_id: toId(sceneId) });
    }));

  panel.command('delete <id>')
    .description('Delete a panel')
    .option(...aiFlag)
    .action((id: string, o) => withSvc(({ svc }) => {
      svc.command(svc.cutIdOfPanel(toId(id)), labels.deletePanel(svc, toId(id)), () => svc.deletePanel(toId(id)), actorOf(o));
      print({ ok: true, deleted: toId(id) });
    }));

  panel.command('intent <id> <text>')
    .description("Set a panel's intent")
    .option(...aiFlag)
    .action((id: string, text: string, o) => withSvc(({ svc }) => {
      svc.command(svc.cutIdOfPanel(toId(id)), labels.intent(svc, toId(id)), () => svc.setIntent(toId(id), text), actorOf(o));
      print({ ok: true, id: toId(id), intent: text });
    }));

  panel.command('place <panelId> <momentId>')
    .description('Put a moment on a panel (confirms the moment; --ai: an AI pick, nothing is confirmed)')
    .option('--ai', 'Edit by Claude: the panel stays an AI panel and the moment is not confirmed', false)
    .action((panelId: string, momentId: string, o) => withSvc(({ svc }) => {
      svc.command(svc.cutIdOfPanel(toId(panelId)), labels.place(svc, toId(panelId)), () => svc.placeMoment(toId(panelId), toId(momentId), { ai: o.ai }), actorOf(o));
      print({ ok: true, panel_id: toId(panelId), moment_id: toId(momentId) });
    }));

  panel.command('pick <panelId> <momentId>')
    .description('Pick one candidate of a panel (same as place)')
    .action((panelId: string, momentId: string) => withSvc(({ svc }) => {
      svc.command(svc.cutIdOfPanel(toId(panelId)), labels.pick(svc, toId(panelId)), () => svc.pickCandidate(toId(panelId), toId(momentId)));
      print({ ok: true, panel_id: toId(panelId), moment_id: toId(momentId) });
    }));

  // ---------- moment / moments ----------
  const momentCmd = parent.command('moment').description('Moment decisions');
  momentCmd.command('reject <id>')
    .description('Reject a moment (it leaves candidate lists; a panel using it becomes a gap)')
    .option('--reason <text>', 'Why')
    .option('--cut <id>', 'Cut to log the undo step on (default: Main)')
    .action((id: string, o) => withSvc(({ svc }) => {
      const cutId = logCutOf(svc, o.cut, svc.projectIdOfMoment(toId(id)));
      svc.command(cutId, labels.reject(toId(id), o.reason), () => svc.rejectMoment(toId(id), o.reason));
      print({ ok: true, id: toId(id), status: 'rejected' });
    }));

  momentCmd.command('unreject <id>')
    .description('Undo a rejection: the moment is proposed again')
    .option('--cut <id>', 'Cut to log the undo step on (default: Main)')
    .action((id: string, o) => withSvc(({ svc }) => {
      const cutId = logCutOf(svc, o.cut, svc.projectIdOfMoment(toId(id)));
      svc.command(cutId, labels.unreject(), () => svc.unrejectMoment(toId(id)));
      print({ ok: true, id: toId(id), status: 'proposed' });
    }));

  const momentLog = (svc: StoryboardService, id: string, cut: string | undefined) => logCutOf(svc, cut, svc.projectIdOfMoment(toId(id)));
  const cutOpt = ['--cut <id>', 'Cut to log the undo step on (default: Main)'] as const;

  const aiOpt = ['--ai', 'Edit by Claude (review loop): the moment stays unconfirmed and unprotected; refused on protected moments', false] as const;

  momentCmd.command('trim <id> <start> <end>')
    .description('Set in/out seconds of a moment (clamped to the clip). Every panel using it plays the new range')
    .option(...cutOpt)
    .option(...aiOpt)
    .action((id: string, start: string, end: string, o) => withSvc(({ svc }) => {
      svc.command(momentLog(svc, id, o.cut), labels.trimMoment(), () => svc.trimMoment(toId(id), toNum(start, 'start'), toNum(end, 'end'), { ai: o.ai }), actorOf(o));
      print({ ok: true, id: toId(id) });
    }));

  momentCmd.command('add <clip> <start> <end>')
    .description('Make a new moment on a clip (seconds; clamped to the clip, at least 0.5 s). Yours: confirmed, tier solid, no analysis. Run `analyze` to compute its look fingerprint')
    .option('--description <text>', 'What it shows')
    .option(...cutOpt)
    .option(...aiOpt)
    .action((clip: string, start: string, end: string, o) => withSvc(({ db, svc }) => {
      const cutId = logCutOf(svc, o.cut, svc.projectIdOfClip(toId(clip)));
      const id = svc.command(cutId, labels.newMoment(),
        () => svc.createMoment(toId(clip), toNum(start, 'start'), toNum(end, 'end'), { ai: o.ai, description: o.description }), actorOf(o));
      const row = db.prepare('SELECT id, clip_id, start_sec, end_sec, status, description FROM highlights WHERE id = ?').get(id) as object;
      print({ ok: true, ...row });
    }));

  momentCmd.command('speed <id> <speed>')
    .description('Set playback speed of a moment: 1, 0.5 or 0.25 (needs enough source fps)')
    .option(...cutOpt)
    .option(...aiOpt)
    .action((id: string, speed: string, o) => withSvc(({ svc }) => {
      svc.command(momentLog(svc, id, o.cut), labels.momentSpeed(toNum(speed, 'speed')), () => svc.setMomentSpeed(toId(id), toNum(speed, 'speed'), { ai: o.ai }), actorOf(o));
      print({ ok: true, id: toId(id), speed: toNum(speed) });
    }));

  momentCmd.command('cut-out <id> <from> <to>')
    .description('Cut a stretch (clip seconds, e.g. a shake) out of a moment: it keeps the part before, a new moment gets the part after, with a panel behind each panel using it. Both parts must be at least 1 s')
    .option(...cutOpt)
    .option(...aiOpt)
    .action((id: string, from: string, to: string, o) => withSvc(({ svc }) => {
      const cutId = momentLog(svc, id, o.cut);
      const res = svc.command(cutId, labels.cutOut(), () => svc.cutOutMoment(toId(id), toNum(from, 'from'), toNum(to, 'to'), { ai: o.ai, cutId }), actorOf(o));
      print({ ok: true, id: toId(id), ...res });
    }));

  momentCmd.command('star <id>')
    .description('Star a moment (your override: hero)')
    .option(...cutOpt)
    .action((id: string, o) => withSvc(({ svc }) => {
      svc.command(momentLog(svc, id, o.cut), labels.momentTier('hero'), () => svc.starMoment(toId(id), true));
      print({ ok: true, id: toId(id), starred: true });
    }));

  momentCmd.command('unstar <id>')
    .description('Remove the star (back to the AI tier; an AI hero becomes solid)')
    .option(...cutOpt)
    .action((id: string, o) => withSvc(({ svc }) => {
      svc.command(momentLog(svc, id, o.cut), labels.momentTier(null), () => svc.starMoment(toId(id), false));
      print({ ok: true, id: toId(id), starred: false });
    }));

  momentCmd.command('reset <id>')
    .description('Back to the analysis range and the default speed')
    .option(...cutOpt)
    .action((id: string, o) => withSvc(({ svc }) => {
      svc.command(momentLog(svc, id, o.cut), labels.resetMoment(), () => svc.resetMoment(toId(id)));
      print({ ok: true, id: toId(id) });
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
        console.log(`${String(r.id).padStart(4)}  clip ${r.clip_id}  ${r.start_sec}-${r.end_sec}  ${r.tier}  ${r.status}  ${r.description}${r.speech ? `  "${r.speech}"${r.speech_cut ? ` [cuts ${r.speech_cut}]` : ''}` : ''}`);
      }
    }));

  // ---------- clip ----------
  const clip = parent.command('clip').description('Clip visibility');
  clip.command('hide <id>')
    .description('Hide a clip: its moments leave panels and candidate lists')
    .option('--cut <id>', 'Cut to log the undo step on (default: Main)')
    .action((id: string, o) => withSvc(({ svc }) => {
      const cutId = logCutOf(svc, o.cut, svc.projectIdOfClip(toId(id)));
      svc.command(cutId, labels.hideClip(svc, toId(id)), () => svc.hideClip(toId(id)));
      print({ ok: true, id: toId(id), hidden: true });
    }));
  clip.command('unhide <id>')
    .description('Unhide a clip (panels it left stay gaps)')
    .option('--cut <id>', 'Cut to log the undo step on (default: Main)')
    .action((id: string, o) => withSvc(({ svc }) => {
      const cutId = logCutOf(svc, o.cut, svc.projectIdOfClip(toId(id)));
      svc.command(cutId, labels.unhideClip(svc, toId(id)), () => svc.unhideClip(toId(id)));
      print({ ok: true, id: toId(id), hidden: false });
    }));
}
