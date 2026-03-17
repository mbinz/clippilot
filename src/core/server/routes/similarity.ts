import { Hono } from 'hono';
import type Database from 'better-sqlite3';
import { ClipRepository } from '../../../db/repositories/clip.repository.js';
import { SimilarityRepository } from '../../../db/repositories/similarity.repository.js';
import { computeSimilarityClusters } from '../../similarity/index.js';

export function createSimilarityRoutes(db: Database.Database): Hono {
  const app = new Hono();
  const clipRepo = new ClipRepository(db);
  const simRepo = new SimilarityRepository(db);

  // GET /similarity/clusters - Get all similarity clusters
  app.get('/clusters', (c) => {
    const projectId = c.req.query('project_id') ? Number(c.req.query('project_id')) : undefined;
    const groups = simRepo.getGroups(projectId);

    const data = groups.map((group) => {
      const result = simRepo.getGroupWithMembers(group.id);
      return {
        ...group,
        members: result?.members ?? [],
      };
    });

    return c.json({ data });
  });

  // GET /similarity/clusters/:id - Get a single cluster with members
  app.get('/clusters/:id', (c) => {
    const id = Number(c.req.param('id'));
    const result = simRepo.getGroupWithMembers(id);
    if (!result) {
      return c.json({ error: 'Cluster not found' }, 404);
    }
    return c.json({ data: { ...result.group, members: result.members } });
  });

  // POST /similarity/compute - Trigger similarity computation
  app.post('/compute', (c) => {
    const clips = clipRepo.listAll();
    const clusters = computeSimilarityClusters(clips);

    // Clear existing groups and insert new ones
    simRepo.clearGroups();

    for (const cluster of clusters) {
      // Determine project_id from the first member
      const firstClip = clipRepo.findById(cluster.members[0].clip_id);
      const projectId = firstClip?.project_id ?? null;

      const groupId = simRepo.insertGroup(projectId, cluster.reason);
      simRepo.insertMembers(groupId, cluster.members.map((m) => ({
        clip_id: m.clip_id,
        is_best: m.is_best,
        score: m.similarity_score,
      })));
    }

    return c.json({ data: { clusters_found: clusters.length } });
  });

  // PATCH /similarity/clusters/:id/best - Mark best clip in a cluster
  app.patch('/clusters/:id/best', async (c) => {
    const groupId = Number(c.req.param('id'));
    const body = await c.req.json<{ clip_id: number }>();

    const result = simRepo.getGroupWithMembers(groupId);
    if (!result) {
      return c.json({ error: 'Cluster not found' }, 404);
    }

    simRepo.markBest(groupId, body.clip_id);
    return c.json({ data: { success: true } });
  });

  // GET /similarity/by-clip/:clipId - Get clusters containing a clip
  app.get('/by-clip/:clipId', (c) => {
    const clipId = Number(c.req.param('clipId'));
    const groups = simRepo.findGroupsByClip(clipId);

    const data = groups.map((group) => {
      const result = simRepo.getGroupWithMembers(group.id);
      return {
        ...group,
        members: result?.members ?? [],
      };
    });

    return c.json({ data });
  });

  return app;
}
