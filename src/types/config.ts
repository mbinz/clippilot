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
  /** Path to a multilingual whisper.cpp model (ggml-*.bin) used by `transcribe`. */
  whisper_model: string;
  /** Silero VAD model (ggml) for whisper; when the file is missing transcription runs without VAD. */
  whisper_vad_model: string;
  /** VAD speech threshold (whisper -vt) and padding in ms (-vp); low values keep speech in wind. */
  whisper_vad_threshold: number;
  whisper_vad_pad_ms: number;
  /** ISO codes of the languages spoken in the footage; clips detected as another language get an empty transcript. */
  languages: string[];
  /** IANA time zone of the footage (event names / time groups); unset = system zone. */
  timezone?: string;
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
