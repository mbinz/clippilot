export const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mov', '.avi', '.mkv', '.mts', '.m4v', '.webm',
]);

export const CLIPPILOT_DIR = '.clippilot';
export const PROXY_DIR = '.clippilot/proxies';
export const THUMBNAIL_DIR = '.clippilot/thumbnails';
export const DB_PATH = '.clippilot/clippilot.db';
export const CONFIG_PATH = '.clippilot/config.json';

export const DEFAULT_PROXY_RESOLUTION = 720;
export const DEFAULT_PROXY_CRF = 28;
export const DEFAULT_AUDIO_BITRATE = '96k';
export const DEFAULT_THUMBNAIL_COUNT = 5;
export const DEFAULT_THUMBNAIL_WIDTH = 320;

export const MAX_GEMINI_PARALLEL = 10;
export const MAX_FFMPEG_PARALLEL = 2;

export const DEFAULT_WEB_UI_PORT = 3847;
