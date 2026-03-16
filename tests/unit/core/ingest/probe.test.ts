import { describe, it, expect } from 'vitest';
import { parseProbeOutput } from '../../../../src/core/ingest/probe.js';

const SAMPLE_FFPROBE_OUTPUT = JSON.stringify({
  streams: [
    {
      codec_type: 'video',
      codec_name: 'h264',
      width: 3840,
      height: 2160,
      r_frame_rate: '30000/1001',
      tags: {
        creation_time: '2025-06-15T14:30:00.000000Z',
      },
    },
    {
      codec_type: 'audio',
      codec_name: 'aac',
    },
  ],
  format: {
    duration: '125.500000',
    tags: {},
  },
});

describe('parseProbeOutput', () => {
  it('extracts duration', () => {
    const meta = parseProbeOutput(SAMPLE_FFPROBE_OUTPUT, 800000000);
    expect(meta.duration_sec).toBeCloseTo(125.5);
  });

  it('extracts resolution', () => {
    const meta = parseProbeOutput(SAMPLE_FFPROBE_OUTPUT, 800000000);
    expect(meta.resolution).toBe('3840x2160');
  });

  it('extracts fps', () => {
    const meta = parseProbeOutput(SAMPLE_FFPROBE_OUTPUT, 800000000);
    expect(meta.fps).toBeCloseTo(29.97, 1);
  });

  it('extracts codec', () => {
    const meta = parseProbeOutput(SAMPLE_FFPROBE_OUTPUT, 800000000);
    expect(meta.codec).toBe('h264');
  });

  it('extracts recorded_at from stream tags', () => {
    const meta = parseProbeOutput(SAMPLE_FFPROBE_OUTPUT, 800000000);
    expect(meta.recorded_at).toBe('2025-06-15T14:30:00.000000Z');
  });

  it('uses file_size parameter', () => {
    const meta = parseProbeOutput(SAMPLE_FFPROBE_OUTPUT, 123456);
    expect(meta.file_size).toBe(123456);
  });

  it('handles missing creation_time', () => {
    const noDate = JSON.stringify({
      streams: [{ codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, r_frame_rate: '30/1' }],
      format: { duration: '10.0' },
    });
    const meta = parseProbeOutput(noDate, 1000);
    expect(meta.recorded_at).toBeNull();
  });

  it('handles missing video stream gracefully', () => {
    const audioOnly = JSON.stringify({
      streams: [{ codec_type: 'audio', codec_name: 'aac' }],
      format: { duration: '60.0' },
    });
    const meta = parseProbeOutput(audioOnly, 1000);
    expect(meta.resolution).toBe('0x0');
    expect(meta.codec).toBe('unknown');
    expect(meta.fps).toBe(0);
  });
});
