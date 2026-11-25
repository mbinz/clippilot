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

/** Unknown issue values (e.g. a retired tag) are dropped instead of failing the whole clip's validation. */
const ISSUES = ['blur', 'obstructed', 'overexposed', 'underexposed'] as const;
type Issue = (typeof ISSUES)[number];

export const HighlightSchema = z.object({
  start_sec: z.number(),
  end_sec: z.number(),
  description: z.string().default(''),
  tier: z.enum(['hero', 'solid', 'filler']),
  shot: z.enum(['wide', 'medium', 'close', 'detail']),
  role: z.enum(['establishing', 'action', 'reaction', 'detail', 'transition']),
  issues: z.array(z.string()).transform((l) => l.filter((i): i is Issue => (ISSUES as readonly string[]).includes(i))).default([]),
  slowmo: z.enum(['none', 'light', 'strong']).default('none'),
  slowmo_reason: z.string().default(''),
  audio_keep: z.boolean().default(false),
  audio_type: z.enum(['ambient', 'speech', 'music', 'noise']).default('noise'),
});

export type SlowmoLevel = z.infer<typeof HighlightSchema>['slowmo'];
export type HighlightResponse = z.input<typeof HighlightSchema>;

export const ClipAnalysisResponseSchema = z.object({
  scenes: z.array(SceneSchema),
  clip_summary: z.string(),
  highlights: z.array(HighlightSchema).default([]),
});

export type ClipAnalysisResponse = z.infer<typeof ClipAnalysisResponseSchema>;
