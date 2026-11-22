import path from 'node:path';
import { Hono, type Context } from 'hono';
import type Database from 'better-sqlite3';
import { ProjectRepository } from '../../../db/repositories/project.repository.js';
import { ThumbnailRepository } from '../../../db/repositories/thumbnail.repository.js';
import { StoryboardService, type PanelNode } from '../../storyboard/service.js';

type Body = Record<string, unknown>;

/** Mounted at /api: storyboard (cut / scene / panel) routes, thin wrappers over StoryboardService. */
export function createCutRoutes(db: Database.Database): Hono {
  const app = new Hono();
  const svc = new StoryboardService(db);
  const projects = new ProjectRepository(db);
  const thumbs = new ThumbnailRepository(db);

  const media = (clipId: number, proxyPath: string | null) => {
    const [first] = thumbs.findByClip(clipId);
    return {
      thumbnail: first ? `/media/thumbnails/${path.basename(first.file_path)}` : null,
      proxy_url: proxyPath ? `/media/proxies/${path.basename(proxyPath)}` : null,
    };
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
        candidates: p.candidates.map((m) => ({ ...m, ...clipMedia(m.clip_id) })),
      })),
    }));
    return c.json({ data: { ...tree, scenes } });
  });

  app.patch('/cuts/:id', async (c) => {
    const cutId = id(c);
    const body = await bodyOf(c);
    return guard(() => {
      svc.renameCut(cutId, str(body.name, 'name'));
      return svc.getCut(cutId)!.cut;
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
      svc.setBrief(cutId, body.brief, (body.state ?? 'proposed') as 'proposed' | 'confirmed');
      return briefOf(cutId);
    })(c);
  });

  // ---------- scenes ----------
  app.post('/cuts/:id/scenes', async (c) => {
    const cutId = id(c);
    const body = await bodyOf(c);
    return guard(() => svc.addScene(cutId, str(body.name, 'name'), {
      position: body.position === undefined ? undefined : int(body.position, 'position'),
    }))(c);
  });

  app.patch('/scenes/:id', async (c) => {
    const sceneId = id(c);
    const body = await bodyOf(c);
    return guard(() => db.transaction(() => {
      if (body.name !== undefined) svc.renameScene(sceneId, str(body.name, 'name'));
      if (body.event_id !== undefined) svc.setSceneEvent(sceneId, body.event_id === null ? null : int(body.event_id, 'event_id'));
      if (body.name === undefined && body.event_id === undefined) throw new Error('name or event_id is required');
      return sceneRow(sceneId);
    })())(c);
  });

  app.post('/scenes/:id/move', async (c) => {
    const sceneId = id(c);
    const body = await bodyOf(c);
    return guard(() => {
      svc.moveScene(sceneId, int(body.position, 'position'));
      return sceneRow(sceneId);
    })(c);
  });

  app.delete('/scenes/:id', (c) => guard(() => svc.deleteScene(id(c)))(c));

  // ---------- panels ----------
  app.post('/scenes/:id/panels', async (c) => {
    const sceneId = id(c);
    const body = await bodyOf(c);
    return guard(() => svc.addPanel(sceneId, {
      intent: typeof body.intent === 'string' ? body.intent : '',
      momentId: body.moment_id === undefined ? undefined : int(body.moment_id, 'moment_id'),
      candidates: body.candidates === undefined ? undefined
        : (Array.isArray(body.candidates) ? body.candidates : []).map((m) => int(m, 'candidates[]')),
      source: 'user',
    }, body.position === undefined ? undefined : int(body.position, 'position')))(c);
  });

  app.patch('/panels/:id', async (c) => {
    const panelId = id(c);
    const body = await bodyOf(c);
    return guard(() => db.transaction(() => {
      let touched = false;
      if (body.intent !== undefined) {
        if (typeof body.intent !== 'string') throw new Error('intent must be a string');
        svc.setIntent(panelId, body.intent);
        touched = true;
      }
      if (body.start_sec !== undefined || body.end_sec !== undefined) {
        svc.trimPanel(panelId, num(body.start_sec, 'start_sec'), num(body.end_sec, 'end_sec'));
        touched = true;
      }
      if (body.speed !== undefined) {
        svc.setSpeed(panelId, num(body.speed, 'speed'));
        touched = true;
      }
      if (!touched) throw new Error('Nothing to update (intent, start_sec + end_sec, speed)');
      return panelRow(panelId);
    })())(c);
  });

  app.post('/panels/:id/move', async (c) => {
    const panelId = id(c);
    const body = await bodyOf(c);
    return guard(() => {
      svc.movePanel(panelId, int(body.scene_id, 'scene_id'), int(body.position, 'position'));
      return panelRow(panelId);
    })(c);
  });

  app.post('/panels/:id/place', async (c) => {
    const panelId = id(c);
    const body = await bodyOf(c);
    return guard(() => {
      svc.placeMoment(panelId, int(body.moment_id, 'moment_id'));
      return panelRow(panelId);
    })(c);
  });

  app.post('/panels/:id/pick', async (c) => {
    const panelId = id(c);
    const body = await bodyOf(c);
    return guard(() => {
      svc.pickCandidate(panelId, int(body.moment_id, 'moment_id'));
      return panelRow(panelId);
    })(c);
  });

  app.delete('/panels/:id', (c) => guard(() => svc.deletePanel(id(c)))(c));

  // ---------- moments and clips ----------
  app.post('/moments/:id/reject', async (c) => {
    const body = await bodyOf(c);
    return guard(() => {
      svc.rejectMoment(id(c), typeof body.reason === 'string' ? body.reason : undefined);
      return { id: id(c), status: 'rejected' };
    })(c);
  });

  app.post('/clips/:id/hide', (c) => guard(() => { svc.hideClip(id(c)); return { id: id(c), hidden: true }; })(c));
  app.post('/clips/:id/unhide', (c) => guard(() => { svc.unhideClip(id(c)); return { id: id(c), hidden: false }; })(c));

  return app;
}
