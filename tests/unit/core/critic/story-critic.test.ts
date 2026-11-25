import { describe, it, expect, vi } from 'vitest';
import { setup } from '../storyboard/_helpers.js';
import { HighlightRepository } from '../../../../src/db/repositories/highlight.repository.js';
import {
  buildStoryPrompt, runStoryCritic, createGeminiStoryClient, type StoryCriticClient,
} from '../../../../src/core/critic/story-critic.js';
import type { VideoTransport } from '../../../../src/core/analyze/gemini-client.js';

function fixture() {
  const s = setup();
  const clip = s.addClip();
  const [m1, m2] = s.addMoments(clip.id, [{ start_sec: 1, end_sec: 4, description: 'wave' }, { start_sec: 8, end_sec: 10, description: 'sand' }]);
  const cut = s.svc.createCut(s.projectId, 'Main');
  s.svc.setBrief(cut.id, { target_sec: 90, audience: 'family', mood: 'calm', must_have: [{ text: 'sunset' }], ending: 'sunset on the pier' }, 'confirmed');
  const sc = s.svc.addScene(cut.id, 'Beach');
  const p1 = s.svc.addPanel(sc.id, { intent: 'opening wave', momentId: m1!, source: 'ai' });
  const p2 = s.svc.addPanel(sc.id, { intent: 'sand close-up', momentId: m2!, source: 'ai' });
  return { ...s, cut, sc, p1, p2, m1: m1!, m2: m2! };
}

const good = (f: ReturnType<typeof fixture>) => JSON.stringify({
  findings: [{ id: 'F1', severity: 'should', kind: 'trim', panel_id: f.p2.id, message: 'holds too long', proposal: 'out at 9.0' }],
});

function fake(responses: (string | Error)[]): StoryCriticClient & { calls: number } {
  const c = {
    calls: 0,
    async review() {
      const r = responses[Math.min(c.calls++, responses.length - 1)]!;
      if (r instanceof Error) throw r;
      return r;
    },
  };
  return c;
}

describe('buildStoryPrompt [D-11]', () => {
  it('contains the brief, a panel table with labels / ids / intents, the rules and the findings format', () => {
    const f = fixture();
    const p = buildStoryPrompt(f.svc.getCut(f.cut.id)!);
    const text = p.system + '\n' + p.user;
    expect(text).toContain('sunset on the pier');
    expect(text).toContain('family');
    expect(text).toMatch(new RegExp(`S1·P1.*panel ${f.p1.id}.*moment ${f.m1}.*opening wave`));
    expect(text).toMatch(new RegExp(`S1·P2.*panel ${f.p2.id}.*sand close-up`));
    for (const w of ['pacing', 'order', 'scene membership', 'repetition', 'ending', 'too-long', 'cut-off speech']) expect(text.toLowerCase()).toContain(w);
    for (const k of ['must', 'should', 'nit', 'panel_id', 'move_scene', 'cut_out', 'severity']) expect(text).toContain(k);
  });
});

describe('runStoryCritic', () => {
  it('returns validated findings tagged as the story critic, with protected recomputed from the DB', async () => {
    const f = fixture();
    f.db.prepare("UPDATE highlights SET status = 'confirmed' WHERE id = ?").run(f.m2);
    const client = fake([good(f)]);
    const r = await runStoryCritic({ client, model: 'm', preview: '/p.mp4', tree: f.svc.getCut(f.cut.id)!, hl: new HighlightRepository(f.db), round: 2 });
    expect(r).toMatchObject({ critic: 'story', cut_id: f.cut.id, round: 2 });
    expect(r.findings[0]).toMatchObject({ id: 'F1', panel_id: f.p2.id, protected: true });
  });

  it('accepts a bare array of findings', async () => {
    const f = fixture();
    const arr = JSON.stringify(JSON.parse(good(f)).findings);
    const r = await runStoryCritic({ client: fake([arr]), model: 'm', preview: '/p.mp4', tree: f.svc.getCut(f.cut.id)!, hl: new HighlightRepository(f.db), round: 1 });
    expect(r.findings).toHaveLength(1);
  });

  it('retries malformed JSON and invalid findings up to 3 times', async () => {
    const f = fixture();
    const badIds = JSON.stringify({ findings: [{ id: 'X', severity: 'must', kind: 'trim', panel_id: 99999, message: 'm' }] });
    const client = fake(['not json', badIds, good(f)]);
    const r = await runStoryCritic({ client, model: 'm', preview: '/p.mp4', tree: f.svc.getCut(f.cut.id)!, hl: new HighlightRepository(f.db), round: 1 });
    expect(client.calls).toBe(3);
    expect(r.findings).toHaveLength(1);
  });

  it('gives up after 3 bad answers and says what was wrong', async () => {
    const f = fixture();
    const client = fake(['nope']);
    await expect(runStoryCritic({ client, model: 'm', preview: '/p.mp4', tree: f.svc.getCut(f.cut.id)!, hl: new HighlightRepository(f.db), round: 1 }))
      .rejects.toThrow(/after 3 attempts/);
    expect(client.calls).toBe(3);
  });

  it('does not retry API errors', async () => {
    const f = fixture();
    const client = fake([new Error('quota')]);
    await expect(runStoryCritic({ client, model: 'm', preview: '/p.mp4', tree: f.svc.getCut(f.cut.id)!, hl: new HighlightRepository(f.db), round: 1 }))
      .rejects.toThrow('quota');
    expect(client.calls).toBe(1);
  });
});

describe('createGeminiStoryClient', () => {
  it('uploads the preview, waits until active, asks the model with the video + prompt and removes the file', async () => {
    const order: string[] = [];
    const transport: VideoTransport = {
      upload: vi.fn(async () => { order.push('upload'); return { name: 'files/1', uri: 'u://1', mimeType: 'video/mp4' }; }),
      waitActive: vi.fn(async () => { order.push('wait'); }),
      remove: vi.fn(async () => { order.push('remove'); }),
    };
    const generate = vi.fn(async (_req: unknown) => { order.push('generate'); return '{"findings":[]}'; });
    const client = createGeminiStoryClient('key', { transport, generate });
    const text = await client.review('/p.mp4', { system: 'SYS', user: 'USER' }, 'gemini-2.5-pro');
    expect(text).toBe('{"findings":[]}');
    expect(order).toEqual(['upload', 'wait', 'generate', 'remove']);
    const req = generate.mock.calls[0]![0] as any;
    expect(req.model).toBe('gemini-2.5-pro');
    expect(req.contents[0].parts).toEqual([{ fileData: { fileUri: 'u://1', mimeType: 'video/mp4' } }, { text: 'USER' }]);
    expect(req.config).toMatchObject({ systemInstruction: 'SYS', responseMimeType: 'application/json' });
  });

  it('removes the uploaded file even when the model call fails', async () => {
    const transport: VideoTransport = {
      upload: async () => ({ name: 'files/1', uri: 'u', mimeType: 'video/mp4' }), waitActive: async () => {}, remove: vi.fn(async () => {}),
    };
    const client = createGeminiStoryClient('k', { transport, generate: async () => { throw new Error('boom'); } });
    await expect(client.review('/p.mp4', { system: 's', user: 'u' }, 'm')).rejects.toThrow('boom');
    expect(transport.remove).toHaveBeenCalledWith('files/1');
  });
});
