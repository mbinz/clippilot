import { z } from 'zod';

export const SceneSchema = z.object({
  start_sec: z.number(),
  end_sec: z.number(),
  description_de: z.string(),
  description_en: z.string(),
  subjects: z.array(z.string()),
  setting: z.string(),
  activity: z.string(),
  mood: z.string(),
  visual_keywords: z.array(z.string()),
});

export const TechnicalQualitySchema = z.object({
  stability: z.number().min(1).max(5),
  focus: z.number().min(1).max(5),
  exposure: z.number().min(1).max(5),
  composition: z.number().min(1).max(5),
  audio_quality: z.number().min(1).max(5),
  overall_score: z.number().min(1).max(5),
  issues: z.array(z.string()),
});

export const EditorialValueSchema = z.object({
  emotional_impact: z.number().min(1).max(5),
  storytelling_potential: z.number().min(1).max(5),
  uniqueness: z.number().min(1).max(5),
  suggested_use: z.enum(['Hero Shot', 'B-Roll', 'Establishing', 'Transition', 'Skip']),
});

export const ClipAnalysisResponseSchema = z.object({
  scenes: z.array(SceneSchema),
  technical_quality: TechnicalQualitySchema,
  editorial_value: EditorialValueSchema,
  clip_summary: z.string(),
});

export type ClipAnalysisResponse = z.infer<typeof ClipAnalysisResponseSchema>;
