import pLimit from 'p-limit';
import { MAX_FFMPEG_PARALLEL, MAX_GEMINI_PARALLEL } from '../constants.js';

export function createFfmpegLimiter(concurrency: number = MAX_FFMPEG_PARALLEL) {
  return pLimit(concurrency);
}

export function createGeminiLimiter(concurrency: number = MAX_GEMINI_PARALLEL) {
  return pLimit(concurrency);
}
