import { GoogleGenAI } from '@google/genai';
import { readFile, stat } from 'node:fs/promises';
import type { AppConfig } from '../../types/config.js';
import { ClipAnalysisResponseSchema, type ClipAnalysisResponse } from './schema.js';
import { SYSTEM_PROMPT, USER_PROMPT } from './prompts.js';
import { GeminiApiError } from '../../utils/errors.js';

const MAX_RETRIES = 5;
const MAX_PARSE_ATTEMPTS = 3;
const INITIAL_BACKOFF_MS = 1000;

/** Inline requests cap at ~20 MB; base64 grows 33 %, so keep headroom. */
export const INLINE_MAX_BYTES = 18 * 1024 * 1024;
const FILE_POLL_MS = 2000;
const FILE_MAX_WAIT_MS = 120_000;

export type VideoPart =
  | { inlineData: { mimeType: string; data: string } }
  | { fileData: { fileUri: string; mimeType: string } };

export interface UploadedFile {
  name: string;
  uri: string;
  mimeType: string;
}

export interface VideoTransport {
  upload(path: string): Promise<UploadedFile>;
  waitActive(name: string): Promise<void>;
  remove(name: string): Promise<void>;
}

export function buildRequest(model: string, videoPart: VideoPart) {
  return {
    model,
    contents: [
      {
        role: 'user',
        parts: [
          videoPart,
          { text: USER_PROMPT },
        ],
      },
    ],
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: 'application/json',
    },
  };
}

export class GeminiClient {
  private ai: GoogleGenAI;
  private model: string;

  private generate: (part: VideoPart) => Promise<string>;
  private transport: VideoTransport;
  private fileSize: (path: string) => Promise<number>;

  constructor(
    config: AppConfig,
    generate?: (part: VideoPart) => Promise<string>,
    transport?: VideoTransport,
    fileSize?: (path: string) => Promise<number>,
  ) {
    this.ai = new GoogleGenAI({ apiKey: config.gemini_api_key });
    this.model = config.gemini_model;
    this.generate = generate ?? ((part) => this.generateViaApi(part));
    this.transport = transport ?? this.apiTransport();
    this.fileSize = fileSize ?? (async (p) => (await stat(p)).size);
  }

  private async generateViaApi(part: VideoPart): Promise<string> {
    const response = await this.ai.models.generateContent(buildRequest(this.model, part));
    return response.text ?? '';
  }

  private apiTransport(): VideoTransport {
    return {
      upload: async (path) => {
        const f = await this.ai.files.upload({ file: path, config: { mimeType: 'video/mp4' } });
        return { name: f.name ?? '', uri: f.uri ?? '', mimeType: f.mimeType ?? 'video/mp4' };
      },
      waitActive: async (name) => {
        const deadline = Date.now() + FILE_MAX_WAIT_MS;
        for (;;) {
          const f = await this.ai.files.get({ name });
          if (f.state === 'ACTIVE') return;
          if (f.state === 'FAILED') throw new Error(`File processing failed: ${name}`);
          if (Date.now() >= deadline) throw new Error(`File not active after ${FILE_MAX_WAIT_MS / 1000}s: ${name}`);
          await new Promise((resolve) => setTimeout(resolve, FILE_POLL_MS));
        }
      },
      remove: async (name) => {
        await this.ai.files.delete({ name });
      },
    };
  }

  async analyzeVideo(proxyPath: string): Promise<ClipAnalysisResponse> {
    const size = await this.fileSize(proxyPath);
    if (Math.ceil(size / 3) * 4 <= INLINE_MAX_BYTES) {
      const videoBuffer = await readFile(proxyPath);
      return this.analyzeWithPart({
        inlineData: { mimeType: 'video/mp4', data: videoBuffer.toString('base64') },
      });
    }

    let uploadedName: string | null = null;
    try {
      const file = await this.transport.upload(proxyPath);
      uploadedName = file.name;
      await this.transport.waitActive(file.name);
      return await this.analyzeWithPart({ fileData: { fileUri: file.uri, mimeType: file.mimeType } });
    } catch (err) {
      if (err instanceof GeminiApiError) throw err;
      throw new GeminiApiError(`File upload failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (uploadedName) {
        try {
          await this.transport.remove(uploadedName);
        } catch {
          // best effort; Gemini expires files after 48 h
        }
      }
    }
  }

  private async analyzeWithPart(part: VideoPart): Promise<ClipAnalysisResponse> {
    let lastError: Error | null = null;
    let attemptsMade = 0;
    let parseAttempts = 0;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      attemptsMade++;
      let text: string;
      try {
        text = await this.generate(part);
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
