import type { Clip } from '../../types/clip.js';
import type { AppConfig } from '../../types/config.js';
import type { ClipRepository } from '../../db/repositories/clip.repository.js';
import type { HighlightRepository } from '../../db/repositories/highlight.repository.js';
import type { TranscriptRepository } from '../../db/repositories/transcript.repository.js';
import type { MotionRepository } from '../../db/repositories/motion.repository.js';
import { writeMomentColumns } from '../motion/index.js';
import { analyzeClips, type AnalysisClient, type AnalyzeResult } from './index.js';

export interface AnalyzeSteps {
  /** Transcribe the clips that have no transcript (no-op without a whisper model). */
  transcribe(clips: Clip[]): Promise<void>;
  /** Measure motion curves + shakes of the clips (also without moments). */
  measure(clips: Clip[]): Promise<void>;
}

/**
 * A2 order for the clips being analysed: transcribe, measure motion + shakes, then the AI analysis with the measured
 * context in the prompt, then the new moments get their motion columns from the stored curve. A failing step is not
 * fatal: the analysis runs without that part of the context.
 */
export async function analyzeAware(
  clips: Clip[],
  config: AppConfig,
  repos: { clips: ClipRepository; highlights: HighlightRepository; transcripts: TranscriptRepository; motion: MotionRepository },
  steps: AnalyzeSteps,
  onProgress: (current: number, filename: string) => void,
  client?: AnalysisClient,
  onStepError: (step: 'transcribe' | 'measure', err: unknown) => void = () => {},
): Promise<AnalyzeResult> {
  try { await steps.transcribe(clips); } catch (err) { onStepError('transcribe', err); }
  try { await steps.measure(clips); } catch (err) { onStepError('measure', err); }
  const result = await analyzeClips(clips, config, repos.clips, onProgress, repos.highlights, client, repos.transcripts, repos.motion);
  for (const c of clips) writeMomentColumns(c.id, { highlights: repos.highlights, motion: repos.motion });
  return result;
}
