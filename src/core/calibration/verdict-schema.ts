import { z } from 'zod';

const VerdictExportSchema = z.object({
  project: z.string(),
  db_generated_at: z.string(),
  reviewed_at: z.string(),
  highlights: z.array(z.object({
    highlight_id: z.number().int(),
    clip_id: z.number().int(),
    verdicts: z.array(z.string()),
    note: z.string().default(''),
  })),
  missed: z.array(z.object({
    clip_id: z.number().int(),
    at_sec: z.number(),
    note: z.string().default(''),
  })),
  clip_notes: z.array(z.object({ clip_id: z.number().int(), note: z.string() })),
  // absent in older exports
  clip_scores: z.array(z.object({
    clip_id: z.number().int(),
    score: z.string(),
    verdict: z.enum(['low', 'ok', 'high']),
  })).default([]),
  suggested_use_wrong: z.array(z.number().int()).default([]),
  // clips the user went through (review page v2); absent in older exports
  reviewed_clips: z.array(z.number().int()).default([]),
});

export type VerdictExport = z.infer<typeof VerdictExportSchema>;

export function parseVerdictExport(raw: unknown): VerdictExport {
  return VerdictExportSchema.parse(raw);
}
