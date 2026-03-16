import pLimit from 'p-limit';
import path from 'node:path';
import type { Clip } from '../../types/clip.js';
import type { AppConfig } from '../../types/config.js';
import type { ClipRepository } from '../../db/repositories/clip.repository.js';
import { GeminiClient } from './gemini-client.js';
import type { ClipAnalysisResponse } from './schema.js';

export interface AnalyzeResult {
  success: number;
  errors: number;
}

function analysisToDbFields(analysis: ClipAnalysisResponse) {
  const allKeywords = analysis.scenes.flatMap((s) => s.visual_keywords);
  const uniqueKeywords = [...new Set(allKeywords)];

  return {
    ai_scenes: JSON.stringify(analysis.scenes),
    ai_summary: analysis.clip_summary,
    ai_quality_stability: analysis.technical_quality.stability,
    ai_quality_focus: analysis.technical_quality.focus,
    ai_quality_exposure: analysis.technical_quality.exposure,
    ai_quality_composition: analysis.technical_quality.composition,
    ai_quality_audio: analysis.technical_quality.audio_quality,
    ai_quality_overall: analysis.technical_quality.overall_score,
    ai_quality_issues: JSON.stringify(analysis.technical_quality.issues),
    ai_editorial_emotional: analysis.editorial_value.emotional_impact,
    ai_editorial_storytelling: analysis.editorial_value.storytelling_potential,
    ai_editorial_uniqueness: analysis.editorial_value.uniqueness,
    ai_editorial_suggested_use: analysis.editorial_value.suggested_use,
    ai_visual_keywords: JSON.stringify(uniqueKeywords),
  };
}

export async function analyzeClips(
  clips: Clip[],
  config: AppConfig,
  clipRepo: ClipRepository,
  onProgress: (current: number, filename: string) => void,
): Promise<AnalyzeResult> {
  const client = new GeminiClient(config);
  const limiter = pLimit(config.analysis_parallelism);
  let success = 0;
  let errors = 0;
  let processed = 0;

  const tasks = clips.map((clip) =>
    limiter(async () => {
      const videoPath = clip.proxy_path ?? clip.file_path;
      const fileName = path.basename(clip.file_path);

      try {
        clipRepo.updateAnalysisStatus(clip.id, 'analyzing');
        const analysis = await client.analyzeVideo(videoPath);
        const dbFields = analysisToDbFields(analysis);
        clipRepo.updateAnalysis(clip.id, dbFields);
        success++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        clipRepo.updateAnalysisError(clip.id, msg);
        errors++;
      }

      processed++;
      onProgress(processed, fileName);
    }),
  );

  await Promise.all(tasks);

  return { success, errors };
}
