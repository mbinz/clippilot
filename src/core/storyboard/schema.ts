import { z } from 'zod';

export const BriefSchema = z.object({
  target_sec: z.number().positive(),
  /** Who the film is for, e.g. "family", "friends / social"; steers tone and length. */
  audience: z.string().min(1),
  mood: z.string(),
  must_have: z.array(z.object({
    moment_id: z.number().int().optional(),
    text: z.string().min(1),
  })),
  ending: z.string(),
  notes: z.string().optional(),
});
export type Brief = z.infer<typeof BriefSchema>;

export const BriefStateSchema = z.enum(['proposed', 'confirmed']);

const DraftPanelSchema = z.object({
  intent: z.string().min(1),
  moment_id: z.number().int().optional(),
  candidates: z.array(z.number().int()).min(2).max(5).optional(),
  start_sec: z.number().optional(),
  end_sec: z.number().optional(),
  speed: z.number().optional(),
}).refine((p) => !(p.moment_id !== undefined && p.candidates !== undefined), {
  message: 'use either moment_id or candidates, not both',
  path: ['candidates'],
});

export const DraftSchema = z.object({
  scenes: z.array(z.object({
    name: z.string().min(1),
    event_id: z.number().int().optional(),
    notes: z.string().optional(),
    panels: z.array(DraftPanelSchema),
  })),
});
export type Draft = z.infer<typeof DraftSchema>;

export class DraftValidationError extends Error {
  constructor(public errors: string[]) {
    super(`Draft is invalid (${errors.length} error${errors.length === 1 ? '' : 's'}):\n${errors.map((e) => `  - ${e}`).join('\n')}`);
    this.name = 'DraftValidationError';
  }
}

/** Zod issues as "path: message" lines. */
export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
}
