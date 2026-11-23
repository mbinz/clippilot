import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { Hono, type Context } from 'hono';
import type Database from 'better-sqlite3';
import { ProjectRepository } from '../../../db/repositories/project.repository.js';
import { ThumbnailRepository } from '../../../db/repositories/thumbnail.repository.js';
import { StoryboardService, type PanelNode } from '../../storyboard/service.js';
import { labels } from '../../storyboard/labels.js';
import { parseSelection, checkSelection, writeBoardSelection, SelectionError } from '../../storyboard/selection.js';
import { cutToSegments } from '../../storyboard/export.js';
import { exportSegments } from '../../export/index.js';
import type { Tier } from '../../tiers.js';

type Body = Record<string, unknown>;

export interface CutRoutesOptions {
  /** Folder that holds `.clippilot` (the project folder); exports are written to `<basePath>/exports/`. */
  basePath?: string;
  /** Runs macOS `open` with these args (injectable for tests). Default: spawn `open` without a shell. */
  opener?: (args: string[]) => void | Promise<void>;
}

const defaultOpener = (args: string[]): Promise<void> => new Promise((resolve, reject) => {
  const child = spawn('open', args, { stdio: 'ignore' });
  child.once('error', reject);
  child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`open exited with code ${code}`))));
});

/** Mounted at /api: storyboard (cut / scene / panel) routes, thin wrappers over StoryboardService. */
export function createCutRoutes(db: Database.Database, options: CutRoutesOptions = {}): Hono {
  const app = new Hono();
  const svc = new StoryboardService(db);
  const projects = new ProjectRepository(db);
  const thumbs = new ThumbnailRepository(db);
  const opener = options.opener ?? defaultOpener;

  const media = (clipId: number, proxyPath: string | null) => {
    const [first] = thumbs.findByClip(clipId);
    return {
      thumbnail: first ? `/media/thumbnails/${path.basename(first.file_path)}` : null,
      proxy_url: proxyPath ? `/media/proxies/${path.basename(proxyPath)}` : null,
    };
  };
  /** Clip info the board needs next to a moment: duration/fps for the timeline and speed gating, proxy for playback. */
  const clipInfo = (clipId: number) => {
    const row = db.prepare('SELECT id, file_path, duration_sec, fps, proxy_path, hidden, recorded_at, event_id FROM clips WHERE id = ?').get(clipId) as
      { id: number; file_path: string; duration_sec: number; fps: number | null; proxy_path: string | null; hidden: number;
        recorded_at: string | null; event_id: number | null } | undefined;
    if (!row) return null;
    return {
      id: row.id, file_name: path.basename(row.file_path), duration_sec: row.duration_sec, fps: row.fps,
      proxy_url: media(row.id, row.proxy_path).proxy_url, hidden: Boolean(row.hidden),
      recorded_at: row.recorded_at, event_id: row.event_id,
    };
  };
  /** URL of the clip thumbnail closest to `sec`. */
  const thumbNear = (clipId: number, sec: number): string | null => {
    const list = thumbs.findByClip(clipId);
    if (!list.length) return null;
    const best = list.reduce((a, b) => (Math.abs(b.timestamp_sec - sec) < Math.abs(a.timestamp_sec - sec) ? b : a));
    return `/media/thumbnails/${path.basename(best.file_path)}`;
  };
  const clipMedia = (clipId: number) => {
    const row = db.prepare('SELECT proxy_path FROM clips WHERE id = ?').get(clipId) as { proxy_path: string | null } | undefined;
    return media(clipId, row?.proxy_path ?? null);
  };

  const bodyOf = async (c: Context): Promise<Body> => {
    const b = await c.req.json<unknown>().catch(() => null);
    return b && typeof b === 'object' && !Array.isArray(b) ? (b as Body) : {};
  };
  const id = (c: Context, name = 'id') => Number(c.req.param(name));
  const int = (v: unknown, what: string): number => {
    if (typeof v !== 'number' || !Number.isInteger(v)) throw new Error(`${what} must be an integer`);
    return v;
  };
  const num = (v: unknown, what: string): number => {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${what} must be a number`);
    return v;
  };
  const str = (v: unknown, what: string): string => {
    if (typeof v !== 'string' || !v.trim()) throw new Error(`${what} is required`);
    return v.trim();
  };

  /** Run a handler; any thrown error becomes a 400 with its message. */
  const guard = (fn: (c: Context) => unknown | Promise<unknown>) => async (c: Context) => {
    try {
      return c.json({ data: await fn(c) ?? { ok: true } });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  };

  /**
   * Run a mutation as one undoable operation on `cutId` and return its result plus the cut's history state.
   * `cutId` and `label` are resolved before the mutation (the rows may be gone afterwards).
   */
  const logged = <T>(cutId: number, label: string, fn: () => T) => {
    const result = svc.command(cutId, label, fn);
    const base = result && typeof result === 'object' && !Array.isArray(result) ? result : { ok: true };
    return { ...base, history: svc.historyState(cutId) };
  };
  /** cut_id of a moment/clip route body: required, must exist and belong to the same project. */
  const cutOf = (body: Body, projectId: number): number => {
    const cutId = int(body.cut_id, 'cut_id');
    if (svc.projectIdOfCut(cutId) !== projectId) throw new Error(`Cut ${cutId} belongs to another project`);
    return cutId;
  };

  const panelRow = (panelId: number) => db.prepare('SELECT * FROM story_segments WHERE id = ?').get(panelId);
  const sceneRow = (sceneId: number) => db.prepare('SELECT * FROM scenes WHERE id = ?').get(sceneId);
  const briefOf = (cutId: number) => {
    const t = svc.getCut(cutId)!;
    return { cut_id: cutId, brief: t.brief, brief_state: t.brief_state };
  };

  // ---------- cuts ----------
  app.get('/projects/:id/cuts', (c) => {
    const pid = id(c);
    if (!projects.findById(pid)) return c.json({ error: 'Project not found' }, 404);
    return c.json({ data: svc.listCuts(pid) });
  });

  app.post('/projects/:id/cuts', async (c) => {
    const pid = id(c);
    if (!projects.findById(pid)) return c.json({ error: 'Project not found' }, 404);
    const body = await bodyOf(c);
    return guard(() => svc.createCut(pid, str(body.name, 'name')))(c);
  });

  app.get('/cuts/:id', (c) => {
    const tree = svc.getCut(id(c));
    if (!tree) return c.json({ error: 'Cut not found' }, 404);
    const scenes = tree.scenes.map((s) => ({
      ...s,
      panels: s.panels.map((p: PanelNode) => ({
        ...p,
        clip: p.clip ? { ...p.clip, ...media(p.clip.id, p.clip.proxy_path) } : null,
        candidates: p.candidates.map((m) => ({ ...m, ...clipMedia(m.clip_id), clip: clipInfo(m.clip_id) })),
      })),
    }));
    return c.json({ data: { ...tree, scenes } });
  });

  app.patch('/cuts/:id', async (c) => {
    const cutId = id(c);
    const body = await bodyOf(c);
    return guard(() => {
      const name = str(body.name, 'name');
      return logged(cutId, labels.renameCut(name), () => {
        svc.renameCut(cutId, name);
        return svc.getCut(cutId)!.cut;
      });
    })(c);
  });

  app.delete('/cuts/:id', (c) => guard(() => {
    if (!svc.getCut(id(c))) throw new Error(`Cut ${id(c)} not found`);
    svc.deleteCut(id(c));
  })(c));

  app.put('/cuts/:id/brief', async (c) => {
    const cutId = id(c);
    const body = await bodyOf(c);
    return guard(() => {
      const state = (body.state ?? 'proposed') as 'proposed' | 'confirmed';
      return logged(cutId, labels.brief(state), () => {
        svc.setBrief(cutId, body.brief, state);
        return briefOf(cutId);
      });
    })(c);
  });

  // ---------- scenes ----------
  app.post('/cuts/:id/scenes', async (c) => {
    const cutId = id(c);
    const body = await bodyOf(c);
    return guard(() => {
      const name = str(body.name, 'name');
      const position = body.position === undefined ? undefined : int(body.position, 'position');
      const eventId = body.event_id === undefined || body.event_id === null ? undefined : int(body.event_id, 'event_id');
      return logged(cutId, labels.addScene(name), () => svc.addScene(cutId, name, { position, eventId }));
    })(c);
  });

  app.patch('/scenes/:id', async (c) => {
    const sceneId = id(c);
    const body = await bodyOf(c);
    return guard(() => {
      if (body.name === undefined && body.event_id === undefined) throw new Error('name or event_id is required');
      const cutId = svc.cutIdOfScene(sceneId);
      const label = body.name !== undefined ? labels.renameScene(str(body.name, 'name')) : labels.sceneEvent(svc, sceneId);
      return logged(cutId, label, () => {
        if (body.name !== undefined) svc.renameScene(sceneId, str(body.name, 'name'));
        if (body.event_id !== undefined) svc.setSceneEvent(sceneId, body.event_id === null ? null : int(body.event_id, 'event_id'));
        return sceneRow(sceneId);
      });
    })(c);
  });

  app.post('/scenes/:id/move', async (c) => {
    const sceneId = id(c);
    const body = await bodyOf(c);
    return guard(() => {
      const position = int(body.position, 'position');
      return logged(svc.cutIdOfScene(sceneId), labels.moveScene(svc, sceneId), () => {
        svc.moveScene(sceneId, position);
        return sceneRow(sceneId);
      });
    })(c);
  });

  app.delete('/scenes/:id', (c) => guard(() => {
    const sceneId = id(c);
    return logged(svc.cutIdOfScene(sceneId), labels.deleteScene(svc, sceneId), () => svc.deleteScene(sceneId));
  })(c));

  // ---------- panels ----------
  app.post('/scenes/:id/panels', async (c) => {
    const sceneId = id(c);
    const body = await bodyOf(c);
    return guard(() => {
      const input = {
        intent: typeof body.intent === 'string' ? body.intent : '',
        momentId: body.moment_id === undefined ? undefined : int(body.moment_id, 'moment_id'),
        candidates: body.candidates === undefined ? undefined
          : (Array.isArray(body.candidates) ? body.candidates : []).map((m) => int(m, 'candidates[]')),
        source: 'user' as const,
      };
      const position = body.position === undefined ? undefined : int(body.position, 'position');
      return logged(svc.cutIdOfScene(sceneId), labels.addPanel(svc, sceneId), () => svc.addPanel(sceneId, input, position));
    })(c);
  });

  app.patch('/panels/:id', async (c) => {
    const panelId = id(c);
    const body = await bodyOf(c);
    return guard(() => {
      if (body.start_sec !== undefined || body.end_sec !== undefined || body.speed !== undefined) {
        throw new Error('In/out and speed live on the moment: use PATCH /moments/:id');
      }
      if (body.intent === undefined) throw new Error('Nothing to update (intent)');
      const cutId = svc.cutIdOfPanel(panelId);
      return logged(cutId, labels.intent(svc, panelId), () => {
        if (typeof body.intent !== 'string') throw new Error('intent must be a string');
        svc.setIntent(panelId, body.intent);
        return panelRow(panelId);
      });
    })(c);
  });

  app.post('/panels/:id/move', async (c) => {
    const panelId = id(c);
    const body = await bodyOf(c);
    return guard(() => {
      const sceneId = int(body.scene_id, 'scene_id');
      const position = int(body.position, 'position');
      return logged(svc.cutIdOfPanel(panelId), labels.movePanel(svc, panelId), () => {
        svc.movePanel(panelId, sceneId, position);
        return panelRow(panelId);
      });
    })(c);
  });

  app.post('/panels/:id/place', async (c) => {
    const panelId = id(c);
    const body = await bodyOf(c);
    return guard(() => {
      const momentId = int(body.moment_id, 'moment_id');
      return logged(svc.cutIdOfPanel(panelId), labels.place(svc, panelId), () => {
        svc.placeMoment(panelId, momentId);
        return panelRow(panelId);
      });
    })(c);
  });

  app.post('/panels/:id/pick', async (c) => {
    const panelId = id(c);
    const body = await bodyOf(c);
    return guard(() => {
      const momentId = int(body.moment_id, 'moment_id');
      return logged(svc.cutIdOfPanel(panelId), labels.pick(svc, panelId), () => {
        svc.pickCandidate(panelId, momentId);
        return panelRow(panelId);
      });
    })(c);
  });

  app.delete('/panels/:id', (c) => guard(() => {
    const panelId = id(c);
    return logged(svc.cutIdOfPanel(panelId), labels.deletePanel(svc, panelId), () => svc.deletePanel(panelId));
  })(c));

  // ---------- moments and clips ----------
  app.get('/projects/:id/moments', (c) => {
    const pid = id(c);
    if (!projects.findById(pid)) return c.json({ error: 'Project not found' }, 404);
    const ev = c.req.query('event_id');
    const eventId = ev === undefined ? undefined : Number(ev);
    if (eventId !== undefined && !Number.isInteger(eventId)) return c.json({ error: 'event_id must be an integer' }, 400);
    const rows = svc.listMoments(pid, {
      eventId,
      includeRejected: c.req.query('include_rejected') === '1',
      includeHidden: c.req.query('include_hidden') === '1',
    });
    return c.json({
      data: rows.map((m) => ({ ...m, thumbnail: thumbNear(m.clip_id, (m.start_sec + m.end_sec) / 2), clip: clipInfo(m.clip_id) })),
    });
  });

  const momentRow = (momentId: number) => db.prepare(
    'SELECT id, clip_id, start_sec, end_sec, speed, user_tier, status FROM highlights WHERE id = ?').get(momentId) as
    { id: number; start_sec: number; end_sec: number } & Record<string, unknown>;

  /** The moment is the edit: in/out, speed and ★ (tier) of a moment, as one undoable step. */
  app.patch('/moments/:id', async (c) => {
    const body = await bodyOf(c);
    return guard(() => {
      const momentId = id(c);
      const cutId = cutOf(body, svc.projectIdOfMoment(momentId));
      const trim = body.start_sec !== undefined || body.end_sec !== undefined;
      const speed = body.speed === undefined ? undefined : num(body.speed, 'speed');
      const tier = body.tier;
      if (tier !== undefined && tier !== null && typeof tier !== 'string') throw new Error('tier must be hero, solid, filler or null');
      const parts: string[] = [];
      if (trim) parts.push(labels.trimMoment());
      if (speed !== undefined) parts.push(labels.momentSpeed(speed));
      if (tier !== undefined) parts.push(labels.momentTier(tier));
      if (!parts.length) throw new Error('Nothing to update (start_sec / end_sec, speed, tier)');
      return logged(cutId, parts.join(', '), () => {
        if (trim) {
          const cur = momentRow(momentId);
          svc.trimMoment(momentId,
            body.start_sec === undefined ? cur.start_sec : num(body.start_sec, 'start_sec'),
            body.end_sec === undefined ? cur.end_sec : num(body.end_sec, 'end_sec'));
        }
        if (speed !== undefined) svc.setMomentSpeed(momentId, speed);
        if (tier !== undefined) svc.setMomentTier(momentId, tier as Tier | null);
        return momentRow(momentId);
      });
    })(c);
  });

  app.post('/moments/:id/reset', async (c) => {
    const body = await bodyOf(c);
    return guard(() => {
      const momentId = id(c);
      const cutId = cutOf(body, svc.projectIdOfMoment(momentId));
      return logged(cutId, labels.resetMoment(), () => {
        svc.resetMoment(momentId);
        return momentRow(momentId);
      });
    })(c);
  });

  /** Board state, not an edit: not logged, not undoable. */
  app.post('/moments/:id/seen', async (c) => {
    const body = await bodyOf(c);
    const momentId = id(c);
    if (!db.prepare('SELECT 1 FROM highlights WHERE id = ?').get(momentId)) return c.json({ error: 'Moment not found' }, 404);
    if (typeof body.seen !== 'boolean') return c.json({ error: 'seen must be a boolean' }, 400);
    svc.setMomentSeen(momentId, body.seen);
    return c.json({ data: { id: momentId, seen: body.seen } });
  });

  /** "Show in Finder": `open -R <file>`. */
  app.post('/clips/:id/reveal', async (c) => {
    const row = db.prepare('SELECT file_path FROM clips WHERE id = ?').get(id(c)) as { file_path: string } | undefined;
    if (!row) return c.json({ error: 'Clip not found' }, 404);
    if (!fs.existsSync(row.file_path)) return c.json({ error: `File not found on disk: ${row.file_path}` }, 409);
    try {
      await opener(['-R', row.file_path]);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
    return c.json({ data: { ok: true, path: row.file_path } });
  });

  app.post('/moments/:id/reject', async (c) => {
    const body = await bodyOf(c);
    return guard(() => {
      const momentId = id(c);
      const reason = typeof body.reason === 'string' ? body.reason : undefined;
      const cutId = cutOf(body, svc.projectIdOfMoment(momentId));
      return logged(cutId, labels.reject(momentId, reason), () => {
        svc.rejectMoment(momentId, reason);
        return { id: momentId, status: 'rejected' };
      });
    })(c);
  });

  app.post('/moments/:id/unreject', async (c) => {
    const body = await bodyOf(c);
    return guard(() => {
      const momentId = id(c);
      const cutId = cutOf(body, svc.projectIdOfMoment(momentId));
      return logged(cutId, labels.unreject(), () => {
        svc.unrejectMoment(momentId);
        return { id: momentId, status: 'proposed' };
      });
    })(c);
  });

  app.post('/clips/:id/hide', async (c) => {
    const body = await bodyOf(c);
    return guard(() => {
      const clipId = id(c);
      const cutId = cutOf(body, svc.projectIdOfClip(clipId));
      return logged(cutId, labels.hideClip(svc, clipId), () => { svc.hideClip(clipId); return { id: clipId, hidden: true }; });
    })(c);
  });
  app.post('/clips/:id/unhide', async (c) => {
    const body = await bodyOf(c);
    return guard(() => {
      const clipId = id(c);
      const cutId = cutOf(body, svc.projectIdOfClip(clipId));
      return logged(cutId, labels.unhideClip(svc, clipId), () => { svc.unhideClip(clipId); return { id: clipId, hidden: false }; });
    })(c);
  });

  // ---------- export ----------
  app.post('/cuts/:id/export', async (c) => {
    const cutId = id(c);
    const tree = svc.getCut(cutId);
    if (!tree) return c.json({ error: 'Cut not found' }, 404);
    const body = await bodyOf(c);
    return guard(() => {
      const format = body.format === undefined ? 'otio' : body.format;
      if (format !== 'otio') throw new Error(`Unsupported export format "${String(format)}" (use otio)`);
      const { segments, skipped_gaps } = cutToSegments(db, cutId);
      if (segments.length === 0) throw new Error(`Cut ${cutId} has no filled panels to export (${skipped_gaps} gap(s))`);

      // OTIO conforms each clip to its own rate; the timeline rate is the most common clip rate.
      const counts = new Map<number, number>();
      for (const sg of segments) if (sg.fps > 0) counts.set(sg.fps, (counts.get(sg.fps) ?? 0) + 1);
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (!top) throw new Error('Could not detect frame rate from clips. Re-ingest the footage.');
      const fps = top[0];

      const res = segments.find((sg) => sg.resolution)?.resolution?.match(/^(\d+)x(\d+)$/);
      const projectName = projects.findById(tree.cut.project_id)?.name ?? 'Project';
      const title = `${projectName} \u2013 ${tree.cut.name}`;
      const output = exportSegments(segments, {
        title, fps, format: 'otio',
        width: res ? Number(res[1]) : undefined,
        height: res ? Number(res[2]) : undefined,
      });
      const dir = path.resolve(options.basePath ?? process.cwd(), 'exports');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${title.replace(/[\\/:*?"<>|]/g, '-')}.otio`);
      fs.writeFileSync(file, output, 'utf-8');
      return {
        path: file, format: 'otio', fps, clips: segments.length,
        scenes: segments.filter((sg) => sg.scene_name).length, skipped_gaps,
      };
    })(c);
  });

  // ---------- history ----------
  app.post('/cuts/:id/undo', (c) => guard(() => {
    const cutId = id(c);
    const r = svc.undo(cutId);
    return { ...r, history: svc.historyState(cutId) };
  })(c));
  app.post('/cuts/:id/redo', (c) => guard(() => {
    const cutId = id(c);
    const r = svc.redo(cutId);
    return { ...r, history: svc.historyState(cutId) };
  })(c));
  app.get('/cuts/:id/head', (c) => {
    if (!svc.getCut(id(c))) return c.json({ error: 'Cut not found' }, 404);
    return c.json({ data: svc.head(id(c)) });
  });

  // ---------- board selection (M8): what the open board has selected, for `clippilot board context` ----------
  app.put('/board/selection', async (c) => {
    try {
      const sel = parseSelection(await c.req.json<unknown>().catch(() => null));
      const problem = checkSelection(db, sel);
      if (problem) return c.json({ error: problem.message }, problem.status);
      return c.json({ data: writeBoardSelection(options.basePath ?? process.cwd(), sel) });
    } catch (err) {
      if (err instanceof SelectionError) return c.json({ error: err.message }, err.status);
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.get('/cuts/:id/history', (c) => {
    if (!svc.getCut(id(c))) return c.json({ error: 'Cut not found' }, 404);
    return c.json({ data: svc.history(id(c)) });
  });

  return app;
}
