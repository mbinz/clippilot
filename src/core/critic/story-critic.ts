import { GoogleGenAI } from '@google/genai';
import type { CutTree } from '../storyboard/service.js';
import type { HighlightRepository } from '../../db/repositories/highlight.repository.js';
import { createApiTransport, type VideoTransport } from '../analyze/gemini-client.js';
import { KINDS, SEVERITIES, panelLabels, parseFindings, type FindingsFile } from './findings.js';

const MAX_ATTEMPTS = 3;

export interface StoryPrompt { system: string; user: string }

/** The story critic's model call: preview video + prompt in, the model's raw text out. Injectable for tests. */
export interface StoryCriticClient {
  review(previewPath: string, prompt: StoryPrompt, model: string): Promise<string>;
}

const SYSTEM = `You are a film editor reviewing a rough cut of a personal travel / family film. You see the whole cut as one video. \
A small label like "S2·P3" (scene 2, panel 3) is burned into the top-left corner of every panel. Sound: panels whose original \
sound is wanted play at full volume, all others as a quiet bed; there is no music yet.

Judge the film as a viewer would. Look for:
- pacing: stretches that drag or rush; static shots held too long (a still image longer than ~3 s without speech or action);
- order: shots that break the story's logic or the brief's intent;
- scene membership: a clip that belongs to the neighbouring scene's event or place;
- repetition: near-identical shots close together;
- ending: does it close the way the brief asks;
- too-long holds and cut-off speech: sentences that are chopped at the start or end of a panel.
Only report real problems; prefer few, concrete findings over many vague ones. Every proposal must be concrete \
(new in/out time, a target scene, a panel to drop). Never invent ids: use only the ids in the panel table.`;

const SPEECH_MAX = 200;
const r1 = (n: number) => Math.round(n * 10) / 10;

const PROPOSAL_FORMAT = `"proposal" is an optional object, fixed per kind (all times are CLIP seconds, i.e. the "in"/"out" numbers of the panel table, not preview time); any proposal may also carry "note": "free text":
- trim: {"start_sec": <new in>, "end_sec": <new out>} (inside the clip, end more than 0.5 s after start)
- replace: {"moment_id": <another moment of the project>}
- remove: {}
- reorder: {"position": <1-based position within the panel's scene>}
- move_scene: {"to_scene_id": <scene id>, "position": <1-based, optional>}
- speed: {"speed": 1 | 0.5 | 0.25}
- cut_out: {"from": <clip s>, "to": <clip s>} (remove the middle part; both inside the panel's in/out)
- other: no proposal`;

/** Brief + panel table (label, ids, scene, clip in/out, speed, preview start, speech, intent) + the output format; the video is attached separately. */
export function buildStoryPrompt(tree: CutTree): StoryPrompt {
  const labels = panelLabels(tree);
  let t = 0;
  const rows = tree.scenes.flatMap((s) => s.panels.map((p) => {
    const m = p.state === 'filled' ? p.moment : p.candidates[0] ?? null;
    let what = 'gap (not in the video)';
    if (m) {
      const speech = m.speech ? ` | speech: "${m.speech.length > SPEECH_MAX ? m.speech.slice(0, SPEECH_MAX) + '…' : m.speech}"` : '';
      what = `moment ${m.id} | clip ${m.clip_id} in ${m.start_sec} out ${m.end_sec} s (clip time) speed ${m.speed} | preview ${r1(t).toFixed(1)} s | ${m.description}${speech}`;
      t += (m.end_sec - m.start_sec) / m.speed;
    }
    return `${labels.get(p.id)} | panel ${p.id} | scene ${s.id} "${s.name}" | ${what} | intent: ${p.intent}`;
  }));
  const user = `Brief:\n${JSON.stringify(tree.brief ?? {}, null, 2)}\n\n` +
    `Panels in order (label | ids | clip in/out in clip seconds, speed, start time in the preview | description | speech said in it, when there is a transcript | intent). ` +
    `Use the speech to place trims on sentence boundaries:\n${rows.join('\n')}\n\n` +
    `Answer with JSON only: {"findings": [{"id": "F1", "severity": "${SEVERITIES.join('|')}", "kind": "${KINDS.join('|')}", ` +
    `"panel_id": <number, optional>, "moment_id": <number, optional>, "scene_id": <number, optional>, "message": "what is wrong", ` +
    `"proposal": {...optional}}]}.\n${PROPOSAL_FORMAT}\n` +
    'severity: must = clearly breaks the film, should = worth fixing, nit = minor taste. Ids F1, F2, ... must be unique. ' +
    'Refer to panels by panel_id (and moment_id when it is about the clip), to scenes by scene_id. An empty list is a valid answer.';
  return { system: SYSTEM, user };
}

/**
 * Ask the model for findings on the cut's preview; the answer is validated like `critic save` (schema, ids exist in the cut,
 * protected recomputed). Malformed or invalid answers are retried up to 3 times; API errors are not.
 */
export async function runStoryCritic(o: {
  client: StoryCriticClient; model: string; preview: string; tree: CutTree; hl: HighlightRepository; round: number;
}): Promise<FindingsFile> {
  const prompt = buildStoryPrompt(o.tree);
  let last: string[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const text = await o.client.review(o.preview, prompt, o.model);
    let raw: unknown;
    try { raw = JSON.parse(text); } catch (err) { last = [`not valid JSON: ${(err as Error).message}`]; continue; }
    const findings = Array.isArray(raw) ? raw : (raw as { findings?: unknown })?.findings;
    const r = parseFindings({ critic: 'story', cut_id: o.tree.cut.id, round: o.round, findings }, o.tree, o.hl);
    if (r.file) return r.file;
    last = r.errors;
  }
  throw new Error(`Story critic answer was invalid after ${MAX_ATTEMPTS} attempts: ${last.join('; ')}`);
}

export interface GeminiStoryDeps {
  transport?: VideoTransport;
  generate?: (req: { model: string; contents: unknown; config: unknown }) => Promise<string>;
}

/** Real client: Files API upload (as `analyze` does for big proxies), then generateContent with the video and the prompt. */
export function createGeminiStoryClient(apiKey: string, deps: GeminiStoryDeps = {}): StoryCriticClient {
  const ai = new GoogleGenAI({ apiKey });
  const transport = deps.transport ?? createApiTransport(ai);
  const generate = deps.generate ?? (async (req) => (await ai.models.generateContent(req as Parameters<typeof ai.models.generateContent>[0])).text ?? '');
  return {
    async review(previewPath, prompt, model) {
      const file = await transport.upload(previewPath);
      try {
        await transport.waitActive(file.name);
        return await generate({
          model,
          contents: [{ role: 'user', parts: [{ fileData: { fileUri: file.uri, mimeType: file.mimeType } }, { text: prompt.user }] }],
          config: { systemInstruction: prompt.system, responseMimeType: 'application/json' },
        });
      } finally {
        try { await transport.remove(file.name); } catch { /* best effort; Gemini expires files after 48 h */ }
      }
    },
  };
}
