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

export const FindingSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(SEVERITIES),
  kind: z.enum(KINDS),
  panel_id: z.number().int().optional(),
  moment_id: z.number().int().optional(),
  scene_id: z.number().int().optional(),
  message: z.string().min(1),
  proposal: z.string().optional(),
  /** Always recomputed from the database on save; whatever a critic writes here is ignored. */
  protected: z.boolean().default(false),
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

/** Whether a tool must leave the subject of a finding alone: its moment is the user's, or its panel was placed by them. */
function isProtected(f: Finding, panels: Map<number, PanelNode>, hl: HighlightRepository): boolean {
  const momentProtected = (id: number | null | undefined) => id != null && hl.protectionReasons(id).length > 0;
  const panel = f.panel_id === undefined ? undefined : panels.get(f.panel_id);
  return momentProtected(f.moment_id) || momentProtected(panel?.moment_id) || panel?.source === 'user';
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
  const seen = new Set<string>();
  for (const f of file.findings) {
    if (seen.has(f.id)) errors.push(`duplicate finding id "${f.id}"`);
    seen.add(f.id);
    if (f.panel_id !== undefined && !panels.has(f.panel_id)) errors.push(`finding ${f.id}: panel ${f.panel_id} is not in cut ${tree.cut.id}`);
    if (f.moment_id !== undefined && !moments.has(f.moment_id)) errors.push(`finding ${f.id}: moment ${f.moment_id} is not in cut ${tree.cut.id}`);
    if (f.scene_id !== undefined && !scenes.has(f.scene_id)) errors.push(`finding ${f.id}: scene ${f.scene_id} is not in cut ${tree.cut.id}`);
  }
  return {
    errors,
    file: { ...file, findings: file.findings.map((f) => ({ ...f, protected: isProtected(f, panels, hl) })) },
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
  /** One line per applied finding: "<panel label> <kind>: <proposal or message>". */
  applied: string[];
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
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as StoredReview;
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
    for (const { file, review } of this.list(cutId).reverse()) {
      const r = rounds.get(review.round) ?? {
        round: review.round, files: [], findings: 0,
        by_severity: { must: 0, should: 0, nit: 0 },
        by_resolution: { applied: 0, skipped: 0, protected: 0, open: 0 }, applied: [],
      };
      rounds.set(review.round, r);
      r.files.push(file);
      for (const f of review.findings) {
        r.findings++;
        r.by_severity[f.severity]++;
        const res = review.resolutions[f.id];
        r.by_resolution[res?.status ?? 'open']++;
        if (res?.status === 'applied') {
          const where = f.panel_id !== undefined ? (labels.get(f.panel_id) ?? `panel ${f.panel_id}`)
            : f.moment_id !== undefined ? `moment ${f.moment_id}` : f.scene_id !== undefined ? `scene ${f.scene_id}` : 'cut';
          r.applied.push(`${where} ${f.kind}: ${f.proposal ?? f.message}`);
        }
      }
    }
    return [...rounds.values()].sort((a, b) => a.round - b.round);
  }
}
