import { GoogleGenAI } from '@google/genai';
import { readFile } from 'node:fs/promises';
import type { AppConfig } from '../../types/config.js';
import { ClipAnalysisResponseSchema, type ClipAnalysisResponse } from './schema.js';
import { SYSTEM_PROMPT, USER_PROMPT } from './prompts.js';
import { GeminiApiError } from '../../utils/errors.js';

const MAX_RETRIES = 5;
const INITIAL_BACKOFF_MS = 1000;

export class GeminiClient {
  private ai: GoogleGenAI;
  private model: string;

  constructor(config: AppConfig) {
    this.ai = new GoogleGenAI({ apiKey: config.gemini_api_key });
    this.model = config.gemini_model;
  }

  async analyzeVideo(proxyPath: string): Promise<ClipAnalysisResponse> {
    const videoBuffer = await readFile(proxyPath);
    const base64Video = videoBuffer.toString('base64');

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await this.ai.models.generateContent({
          model: this.model,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  inlineData: {
                    mimeType: 'video/mp4',
                    data: base64Video,
                  },
                },
                { text: USER_PROMPT },
              ],
            },
          ],
          config: {
            systemInstruction: SYSTEM_PROMPT,
            responseMimeType: 'application/json',
          },
        });

        const text = response.text ?? '';
        const parsed = JSON.parse(text);
        const validated = ClipAnalysisResponseSchema.parse(parsed);
        return validated;
      } catch (err: any) {
        lastError = err;

        // Retry on rate limit or server errors
        const status = err?.status ?? err?.httpStatusCode;
        if (status === 429 || status === 503) {
          const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, backoff));
          continue;
        }

        // Don't retry on other errors
        break;
      }
    }

    throw new GeminiApiError(
      `Analysis failed after ${MAX_RETRIES} attempts: ${lastError?.message ?? 'Unknown error'}`,
    );
  }
}
