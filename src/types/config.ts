export interface AppConfig {
  gemini_api_key: string;
  gemini_model: string;
  language: string;
  thumbnail_interval_sec: number;
  analysis_parallelism: number;
  proxy: ProxyConfig;
  quality_weights: QualityWeights;
  auto_skip_threshold: number;
  web_ui_port: number;
}

export interface ProxyConfig {
  enabled: boolean;
  resolution: number;
  crf: number;
  audio_bitrate: string;
  skip_if_below_resolution: boolean;
}

export interface QualityWeights {
  stability: number;
  focus: number;
  exposure: number;
  composition: number;
  audio: number;
}
