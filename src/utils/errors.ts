export class ClipPilotError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'ClipPilotError';
  }
}

export class FfmpegNotFoundError extends ClipPilotError {
  constructor() {
    super(
      'ffmpeg/ffprobe not found. Please install ffmpeg and ensure it is on your PATH.',
      'FFMPEG_NOT_FOUND',
    );
    this.name = 'FfmpegNotFoundError';
  }
}

export class GeminiApiError extends ClipPilotError {
  constructor(message: string) {
    super(message, 'GEMINI_API_ERROR');
    this.name = 'GeminiApiError';
  }
}

export class DatabaseError extends ClipPilotError {
  constructor(message: string) {
    super(message, 'DATABASE_ERROR');
    this.name = 'DatabaseError';
  }
}

export class ConfigError extends ClipPilotError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR');
    this.name = 'ConfigError';
  }
}
