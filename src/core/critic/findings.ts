import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { CutTree } from '../storyboard/service.js';
import type { HighlightRepository } from '../../db/repositories/highlight.repository.js';
import { formatIssues } from '../storyboard/schema.js';

export const CRITICS = ['cut', 'story'] as const;
export const SEVERITIES = ['must', 'should', 'nit'] as const;
export const KINDS = ['trim', 'replace', 'remove', 'reorder', 'move_scene', 'speed', 'cut_out', 'other'] as const;
export const RESOLUTIONS = ['applied', 'skipped', 'protected'] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

/**
 * What a finding proposes, machine-applicable. All fields optional; which ones are allowed and valid depends on the finding's
 * `kind` (checked in `validateAgainstCut`). Times are clip seconds. `note` is free text allowed on any proposal.
 */
export const ProposalSchema = z.object({
  start_sec: z.number().optional(), end_sec: z.number().optional(),                       // trim
  moment_id: z.number().int().optional(),                                                  // replace
  position: z.number().int().optional(),                                                   // reorder, move_scene
  to_scene_id: z.number().int().optional(),                                                // move_scene
  speed: z.union([z.literal(1), z.literal(0.5), z.literal(0.25)]).optional(),              // speed
  from: z.number().optional(), to: z.number().optional(),                                  // cut_out
  note: z.string().optional(),
}).strict();
export type Proposal = z.infer<typeof ProposalSchema>;

const PROPOSAL_FIELDS: Record<(typeof KINDS)[number], readonly string[]> = {
  trim: ['start_sec', 'end_sec'], replace: ['moment_id'], remove: [], reorder: ['position'],
  move_scene: ['to_scene_id', 'position'], speed: ['speed'], cut_out: ['from', 'to'], other: [],
};

export const FindingSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(SEVERITIES),
  kind: z.enum(KINDS),
  panel_id: z.number().int().optional(),
  moment_id: z.number().int().optional(),
  scene_id: z.number().int().optional(),
  message: z.string().min(1),
  proposal: ProposalSchema.optional(),
  /** Always recomputed from the database on save; whatever a critic writes here is ignored. */
  protected: z.boolean().default(false),
  /** Stamped at save time (`S2·P3`, `S2` or null); whatever a critic writes here is ignored. Stays correct after panels move. */
  label: z.string().nullable().optional(),
});
export type Finding = z.infer<typeof FindingSchema>;

/** A critic's output [D-12]. */
export const FindingsFileSchema = z.object({
  critic: z.enum(CRITICS),
  cut_id: z.number().int(),
  round: z.number().int().min(1),
  findings: z.array(FindingSchema),
});
export type FindingsFile = z.infer<typeof FindingsFileSchema>;

export interface StoredReview extends FindingsFile {
  saved_at: string;
  resolutions: Record<string, { status: Resolution; note?: string; at: string }>;
}

type PanelNode = CutTree['scenes'][number]['panels'][number];

/** "S2·P3" (scene 2, panel 3 within it; both 1-based) for every panel of the cut: the label burned into the story preview. */
export function panelLabels(tree: CutTree): Map<number, string> {
  const labels = new Map<number, string>();
  tree.scenes.forEach((s, si) => s.panels.forEach((p, pi) => labels.set(p.id, `S${si + 1}·P${pi + 1}`)));
  return labels;
}

function labelOf(f: Finding, tree: CutTree, labels: Map<number, string>): string | null {
  if (f.panel_id !== undefined) return labels.get(f.panel_id) ?? null;
  const si = f.scene_id === undefined ? -1 : tree.scenes.findIndex((s) => s.id === f.scene_id);
  return si >= 0 ? `S${si + 1}` : null;
}

/** Whether a tool must leave the subject of a finding alone: its moment is the user's, or its panel was placed by them. */
function isProtected(f: Finding, panels: Map<number, PanelNode>, hl: HighlightRepository): boolean {
  const momentProtected = (id: number | null | undefined) => id != null && hl.protectionReasons(id).length > 0;
  const panel = f.panel_id === undefined ? undefined : panels.get(f.panel_id);
  return momentProtected(f.moment_id) || momentProtected(panel?.moment_id) || panel?.source === 'user';
}

function proposalErrors(
  f: Finding,
  ctx: { moment: { start: number; end: number; clipDuration: number | null } | undefined; panelsInScene: number | undefined; scenes: Set<number>; hl: HighlightRepository },
): string[] {
  const pr = f.proposal!;
  const e: string[] = [];
  const bad = (msg: string) => e.push(`finding ${f.id}: ${msg}`);
  if (f.kind === 'other') { bad('a finding of kind other has no proposal'); return e; }
  const allowed = PROPOSAL_FIELDS[f.kind];
  for (const k of Object.keys(pr)) {
    if (k !== 'note' && !allowed.includes(k)) bad(`proposal field "${k}" does not belong to kind ${f.kind}${allowed.length ? ` (allowed: ${allowed.join(', ')})` : ''}`);
  }
  switch (f.kind) {
    case 'trim': {
      const { start_sec: a, end_sec: b } = pr;
      if ((a === undefined) !== (b === undefined)) bad('trim needs both start_sec and end_sec');
      else if (a !== undefined && b !== undefined) {
        if (a < 0 || (ctx.moment?.clipDuration != null && b > ctx.moment.clipDuration)) bad(`trim ${a}-${b} s lies outside the clip${ctx.moment?.clipDuration != null ? ` (0-${ctx.moment.clipDuration} s)` : ''}`);
        if (!(b > a + 0.5)) bad(`trim end_sec must be more than 0.5 s after start_sec (got ${a}-${b})`);
      }
      break;
    }
    case 'replace': {
      const id = pr.moment_id;
      if (id !== undefined) {
        const m = ctx.hl.findById(id);
        if (!m) bad(`replace: moment ${id} does not exist`);
        else if (m.status === 'rejected') bad(`replace: moment ${id} is rejected`);
      }
      break;
    }
    case 'reorder':
      if (pr.position !== undefined && (pr.position < 1 || (ctx.panelsInScene !== undefined && pr.position > ctx.panelsInScene))) {
        bad(`reorder position ${pr.position} is outside the scene (1-${ctx.panelsInScene ?? '?'})`);
      }
      break;
    case 'move_scene':
      if (pr.to_scene_id !== undefined && !ctx.scenes.has(pr.to_scene_id)) bad(`move_scene: scene ${pr.to_scene_id} is not in the cut`);
      if (pr.position !== undefined && pr.position < 1) bad(`move_scene position ${pr.position} must be 1 or more`);
      break;
    case 'cut_out': {
      const { from, to } = pr;
      if ((from === undefined) !== (to === undefined)) bad('cut_out needs both from and to');
      else if (from !== undefined && to !== undefined) {
        if (!(to > from)) bad(`cut_out to (${to}) must be after from (${from})`);
        if (ctx.moment && (from < ctx.moment.start || to > ctx.moment.end)) bad(`cut_out ${from}-${to} s lies outside the moment (${ctx.moment.start}-${ctx.moment.end} s)`);
      }
      break;
    }
    default:
  }
  return e;
}

/** Check ids against the cut (everything must exist in it) and recompute `protected` from the database. */
export function validateAgainstCut(
  file: FindingsFile, tree: CutTree, hl: HighlightRepository,
): { errors: string[]; file: FindingsFile } {
  const errors: string[] = [];
  if (file.cut_id !== tree.cut.id) errors.push(`findings are for cut ${file.cut_id}, not cut ${tree.cut.id}`);
  const panels = new Map(tree.scenes.flatMap((s) => s.panels).map((p) => [p.id, p]));
  const scenes = new Set(tree.scenes.map((s) => s.id));
  const moments = new Set<number>();
  for (const p of panels.values()) {
    if (p.moment_id !== null) moments.add(p.moment_id);
    for (const c of p.candidates) moments.add(c.id);
  }
  const momentInfo = new Map<number, { start: number; end: number; clipDuration: number | null }>();
  for (const p of panels.values()) {
    for (const m of [p.moment, ...p.candidates]) {
      if (m) momentInfo.set(m.id, { start: m.start_sec, end: m.end_sec, clipDuration: m.clip_id === p.clip?.id ? p.clip.duration_sec : null });
    }
  }
  const sceneOfPanel = new Map<number, (typeof tree.scenes)[number]>();
  for (const sc of tree.scenes) for (const p of sc.panels) sceneOfPanel.set(p.id, sc);
  const labels = panelLabels(tree);
  const seen = new Set<string>();
  for (const f of file.findings) {
    if (seen.has(f.id)) errors.push(`duplicate finding id "${f.id}"`);
    seen.add(f.id);
    if (f.panel_id !== undefined && !panels.has(f.panel_id)) errors.push(`finding ${f.id}: panel ${f.panel_id} is not in cut ${tree.cut.id}`);
    if (f.moment_id !== undefined && !moments.has(f.moment_id)) errors.push(`finding ${f.id}: moment ${f.moment_id} is not in cut ${tree.cut.id}`);
    if (f.scene_id !== undefined && !scenes.has(f.scene_id)) errors.push(`finding ${f.id}: scene ${f.scene_id} is not in cut ${tree.cut.id}`);
    if (f.proposal) {
      const pf = f.panel_id === undefined ? undefined : panels.get(f.panel_id);
      const mid = f.moment_id ?? pf?.moment?.id ?? pf?.moment_id ?? undefined;
      errors.push(...proposalErrors(f, {
        moment: mid === undefined ? undefined : momentInfo.get(mid),
        panelsInScene: f.panel_id === undefined ? undefined : sceneOfPanel.get(f.panel_id)?.panels.length,
        scenes, hl,
      }));
    }
  }
  return {
    errors,
    file: { ...file, findings: file.findings.map((f) => ({ ...f, protected: isProtected(f, panels, hl), label: labelOf(f, tree, labels) })) },
  };
}

/** Parse + validate what a critic wrote; `file` is set (protected recomputed) only when there are no errors. */
export function parseFindings(
  raw: unknown, tree: CutTree, hl: HighlightRepository,
): { errors: string[]; file: FindingsFile | null } {
  const parsed = FindingsFileSchema.safeParse(raw);
  if (!parsed.success) return { errors: formatIssues(parsed.error), file: null };
  const r = validateAgainstCut(parsed.data, tree, hl);
  return { errors: r.errors, file: r.errors.length ? null : r.file };
}

export interface RoundSummary {
  round: number;
  files: string[];
  findings: number;
  by_severity: Record<(typeof SEVERITIES)[number], number>;
  by_resolution: Record<Resolution | 'open', number>;
  /** One line per applied finding: "<panel label> <kind>: <readable proposal or message>". */
  applied: string[];
  /** Applied changes after merging the same panel + kind fixed by both critics. */
  distinct_changes: number;
}

const t1 = (n: number) => n.toFixed(1);

/** Readable one-liner of a proposal ("12.0–15.5 s", "speed x0.5", ...); null when it says nothing. */
export function describeProposal(p: Proposal | undefined): string | null {
  if (!p) return null;
  const parts: string[] = [];
  if (p.start_sec !== undefined && p.end_sec !== undefined) parts.push(`${t1(p.start_sec)}–${t1(p.end_sec)} s`);
  if (p.from !== undefined && p.to !== undefined) parts.push(`cut ${t1(p.from)}–${t1(p.to)} s`);
  if (p.moment_id !== undefined) parts.push(`moment ${p.moment_id}`);
  if (p.to_scene_id !== undefined) parts.push(`to scene ${p.to_scene_id}${p.position !== undefined ? ` at position ${p.position}` : ''}`);
  else if (p.position !== undefined) parts.push(`to position ${p.position}`);
  if (p.speed !== undefined) parts.push(`speed x${p.speed}`);
  if (p.note) parts.push(parts.length ? `(${p.note})` : p.note);
  return parts.length ? parts.join(' ') : null;
}

const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;

/** Findings files in `<dir>` (`.clippilot/reviews`), named `<timestamp>-<critic>-r<round>.json`. */
export class ReviewStore {
  constructor(private dir: string) {}

  save(file: FindingsFile, now: Date = new Date()): { file: string; path: string } {
    fs.mkdirSync(this.dir, { recursive: true });
    const base = `${stamp(now)}-${file.critic}-r${file.round}`;
    let name = `${base}.json`;
    for (let i = 2; fs.existsSync(path.join(this.dir, name)); i++) name = `${base}-${i}.json`;
    const stored: StoredReview = { ...file, saved_at: now.toISOString(), resolutions: {} };
    fs.writeFileSync(path.join(this.dir, name), JSON.stringify(stored, null, 2));
    return { file: name, path: path.join(this.dir, name) };
  }

  /** Stored reviews, newest first; `cutId` filters. */
  list(cutId?: number): { file: string; review: StoredReview }[] {
    if (!fs.existsSync(this.dir)) return [];
    return fs.readdirSync(this.dir).filter((n) => n.endsWith('.json')).sort().reverse()
      .map((file) => ({ file, review: this.read(path.join(this.dir, file)) }))
      .filter((r) => cutId === undefined || r.review.cut_id === cutId);
  }

  private read(p: string): StoredReview {
    const review = JSON.parse(fs.readFileSync(p, 'utf-8')) as StoredReview;
    // Files written before proposals were structured hold a free string.
    for (const f of review.findings) {
      if (typeof (f as { proposal?: unknown }).proposal === 'string') f.proposal = { note: (f as unknown as { proposal: string }).proposal };
    }
    return review;
  }

  private resolvePath(ref: string): string {
    if (ref === 'latest') {
      const latest = this.list()[0];
      if (!latest) throw new Error('No reviews saved yet');
      return path.join(this.dir, latest.file);
    }
    const p = path.isAbsolute(ref) ? ref : path.join(this.dir, path.basename(ref));
    if (!fs.existsSync(p)) throw new Error(`Review "${ref}" not found in ${this.dir}`);
    return p;
  }

  load(ref: string): StoredReview {
    return this.read(this.resolvePath(ref));
  }

  resolve(ref: string, findingId: string, status: Resolution, note?: string, now: Date = new Date()): StoredReview {
    if (!(RESOLUTIONS as readonly string[]).includes(status)) throw new Error(`Resolution must be applied, skipped or protected (got "${status}")`);
    const p = this.resolvePath(ref);
    const review = this.read(p);
    if (!review.findings.some((f) => f.id === findingId)) throw new Error(`Finding "${findingId}" not in ${path.basename(p)}`);
    review.resolutions[findingId] = { status, ...(note ? { note } : {}), at: now.toISOString() };
    fs.writeFileSync(p, JSON.stringify(review, null, 2));
    return review;
  }

  /** Per round (oldest first) of a cut: counts and the applied changes. `labels` names panels in the change list. */
  summary(cutId: number, labels: Map<number, string> = new Map()): RoundSummary[] {
    const rounds = new Map<number, RoundSummary>();
    const seenChange = new Map<string, { index: number; critics: Set<string>; merged: boolean }>();
    for (const { file, review } of this.list(cutId).reverse()) {
      const r = rounds.get(review.round) ?? {
        round: review.round, files: [], findings: 0,
        by_severity: { must: 0, should: 0, nit: 0 },
        by_resolution: { applied: 0, skipped: 0, protected: 0, open: 0 }, applied: [], distinct_changes: 0,
      };
      rounds.set(review.round, r);
      r.files.push(file);
      for (const f of review.findings) {
        r.findings++;
        r.by_severity[f.severity]++;
        const res = review.resolutions[f.id];
        r.by_resolution[res?.status ?? 'open']++;
        if (res?.status === 'applied') {
          const where = f.label ? f.label
            : f.panel_id !== undefined ? (labels.get(f.panel_id) ?? `panel ${f.panel_id} (deleted)`)
            : f.moment_id !== undefined ? `moment ${f.moment_id}` : f.scene_id !== undefined ? `scene ${f.scene_id}` : 'cut';
          const line = `${where} ${f.kind}: ${describeProposal(f.proposal) ?? f.message}`;
          const key = f.panel_id === undefined ? null : `${review.round}|${f.panel_id}|${f.kind}`;
          const prev = key === null ? undefined : seenChange.get(key);
          if (prev && !prev.critics.has(review.critic)) {
            prev.critics.add(review.critic);
            if (!prev.merged) { r.applied[prev.index] += ' (both critics)'; prev.merged = true; }
          } else {
            r.applied.push(line);
            if (key !== null && !prev) seenChange.set(key, { index: r.applied.length - 1, critics: new Set([review.critic]), merged: false });
          }
        }
      }
    }
    for (const r of rounds.values()) r.distinct_changes = r.applied.length;
    return [...rounds.values()].sort((a, b) => a.round - b.round);
  }
}
