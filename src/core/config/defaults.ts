import type { AppConfig } from '../../types/config.js';

export const DEFAULT_CONFIG: AppConfig = {
  gemini_api_key: '',
  gemini_model: 'gemini-2.5-flash',
  language: 'de',
  thumbnail_interval_sec: 5,
  analysis_parallelism: 5,
  proxy: {
    enabled: true,
    resolution: 720,
    crf: 28,
    audio_bitrate: '96k',
    skip_if_below_resolution: true,
  },
  quality_weights: {
    stability: 0.25,
    focus: 0.25,
    exposure: 0.20,
    composition: 0.15,
    audio: 0.15,
  },
  auto_skip_threshold: 1.5,
  web_ui_port: 3847,
};
