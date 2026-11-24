import pLimit from 'p-limit';
import path from 'node:path';
import type { Clip } from '../../types/clip.js';
import type { AppConfig } from '../../types/config.js';
import type { ClipRepository } from '../../db/repositories/clip.repository.js';
import { GeminiClient } from './gemini-client.js';
import type { HighlightRepository } from '../../db/repositories/highlight.repository.js';
import { normalizeHighlights } from './highlights.js';
import type { TranscriptRepository } from '../../db/repositories/transcript.repository.js';
import type { ClipAnalysisResponse } from './schema.js';

export interface AnalysisClient {
  analyzeVideo(path: string): Promise<ClipAnalysisResponse>;
}

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
    ai_visual_keywords: JSON.stringify(uniqueKeywords),
  };
}

export async function analyzeClips(
  clips: Clip[],
  config: AppConfig,
  clipRepo: ClipRepository,
  onProgress: (current: number, filename: string) => void,
  highlightRepo?: HighlightRepository,
  client: AnalysisClient = new GeminiClient(config),
  transcriptRepo?: TranscriptRepository,
): Promise<AnalyzeResult> {
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
        clipRepo.updateAnalysis(clip.id, analysisToDbFields(analysis));
        highlightRepo?.replaceForClip(
          clip.id,
          normalizeHighlights(analysis.highlights, clip.duration_sec, clip.fps, transcriptRepo?.get(clip.id)?.segments ?? []),
        );
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
