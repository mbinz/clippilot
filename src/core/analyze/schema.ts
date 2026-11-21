import { z } from 'zod';

export const SceneSchema = z.object({
  start_sec: z.number(),
  end_sec: z.number(),
  description_en: z.string(),
  subjects: z.array(z.string()),
  setting: z.string(),
  activity: z.string(),
  mood: z.string(),
  visual_keywords: z.array(z.string()),
});

export const HighlightSchema = z.object({
  start_sec: z.number(),
  end_sec: z.number(),
  description: z.string(),
  tier: z.enum(['hero', 'solid', 'filler']),
  shot: z.enum(['wide', 'medium', 'close', 'detail']),
  role: z.enum(['establishing', 'action', 'reaction', 'detail', 'transition']),
  issues: z.array(z.enum(['shake', 'blur', 'obstructed', 'overexposed', 'underexposed'])).default([]),
  slowmo: z.enum(['none', 'light', 'strong']).default('none'),
  slowmo_reason: z.string().default(''),
});

export type SlowmoLevel = z.infer<typeof HighlightSchema>['slowmo'];
export type HighlightResponse = z.input<typeof HighlightSchema>;

export const ClipAnalysisResponseSchema = z.object({
  scenes: z.array(SceneSchema),
  clip_summary: z.string(),
  highlights: z.array(HighlightSchema).default([]),
});

export type ClipAnalysisResponse = z.infer<typeof ClipAnalysisResponseSchema>;
