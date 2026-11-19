import { GoogleGenAI } from '@google/genai';
import { readFile } from 'node:fs/promises';
import type { AppConfig } from '../../types/config.js';
import { ClipAnalysisResponseSchema, type ClipAnalysisResponse } from './schema.js';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompts.js';
import { loadTasteProfile, tasteProfileDir, type TasteProfile } from '../calibration/taste-profile.js';
import { GeminiApiError } from '../../utils/errors.js';

const MAX_RETRIES = 5;
const MAX_PARSE_ATTEMPTS = 3;
const INITIAL_BACKOFF_MS = 1000;

export class GeminiClient {
  private ai: GoogleGenAI;
  private model: string;

  private generate: (videoBase64: string) => Promise<string>;
  private profile: TasteProfile | null;
  readonly profileVersion: number | null;

  constructor(
    config: AppConfig,
    generate?: (videoBase64: string) => Promise<string>,
    profile: TasteProfile | null = loadTasteProfile(tasteProfileDir()),
  ) {
    this.profile = profile;
    this.profileVersion = profile?.version ?? null;
    this.ai = new GoogleGenAI({ apiKey: config.gemini_api_key });
    this.model = config.gemini_model;
    this.generate = generate ?? ((videoBase64) => this.generateViaApi(videoBase64));
  }

  private async generateViaApi(base64Video: string): Promise<string> {
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'video/mp4', data: base64Video } },
            { text: buildUserPrompt(this.profile) },
          ],
        },
      ],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: 'application/json',
      },
    });
    return response.text ?? '';
  }

  async analyzeVideo(proxyPath: string): Promise<ClipAnalysisResponse> {
    const videoBuffer = await readFile(proxyPath);
    const base64Video = videoBuffer.toString('base64');

    let lastError: Error | null = null;
    let attemptsMade = 0;
    let parseAttempts = 0;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      attemptsMade++;
      let text: string;
      try {
        text = await this.generate(base64Video);
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

      try {
        return ClipAnalysisResponseSchema.parse(JSON.parse(text));
      } catch (err: any) {
        // Malformed or schema-invalid output: retry immediately, up to a cap
        lastError = err;
        if (++parseAttempts >= MAX_PARSE_ATTEMPTS) break;
      }
    }

    throw new GeminiApiError(
      `Analysis failed after ${attemptsMade} attempt${attemptsMade === 1 ? '' : 's'}: ${lastError?.message ?? 'Unknown error'}`,
    );
  }
}
