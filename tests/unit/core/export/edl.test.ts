import { describe, it, expect } from 'vitest';
import { exportEdl } from '../../../../src/core/export/edl.js';
import type { ExportSegment, ExportOptions } from '../../../../src/types/export.js';

const OPTIONS: ExportOptions = { title: 'Mallorca 2025', fps: 30, format: 'edl' };

function makeSegment(overrides: Partial<ExportSegment> = {}): ExportSegment {
  return {
    position: 1,
    clip_id: 1,
    file_path: '/videos/beach.mp4',
    file_name: 'beach.mp4',
    duration_sec: 30,
    start_sec: 0,
    end_sec: 15,
    fps: 30,
    resolution: '1920x1080',
    ai_summary: 'Beach scene',
    ai_quality_overall: 3.5,
    segment_role: 'intro',
    notes: null,
    ...overrides,
  };
}

describe('exportEdl', () => {
  it('starts with TITLE and FCM', () => {
    const edl = exportEdl([makeSegment()], OPTIONS);
    expect(edl).toContain('TITLE: Mallorca 2025');
    expect(edl).toContain('FCM: NON-DROP FRAME');
  });

  it('generates correct event number', () => {
    const edl = exportEdl([makeSegment({ position: 1 }), makeSegment({ position: 2, clip_id: 2 })], OPTIONS);
    expect(edl).toContain('001');
    expect(edl).toContain('002');
  });

  it('includes FROM CLIP NAME', () => {
    const edl = exportEdl([makeSegment()], OPTIONS);
    expect(edl).toContain('* FROM CLIP NAME: beach.mp4');
  });

  it('includes SOURCE FILE with full path', () => {
    const edl = exportEdl([makeSegment()], OPTIONS);
    expect(edl).toContain('* SOURCE FILE: /videos/beach.mp4');
  });

  it('includes timecodes in correct format', () => {
    const edl = exportEdl([makeSegment({ start_sec: 0, end_sec: 15 })], OPTIONS);
    // Source in: 00:00:00:00, Source out: 00:00:15:00
    expect(edl).toContain('00:00:00:00');
    expect(edl).toContain('00:00:15:00');
  });

  it('chain record positions for multiple segments', () => {
    const edl = exportEdl([
      makeSegment({ position: 1, start_sec: 0, end_sec: 10 }),
      makeSegment({ position: 2, clip_id: 2, start_sec: 5, end_sec: 20 }),
    ], OPTIONS);

    // First segment record: 00:00:00:00 to 00:00:10:00
    // Second segment record starts at 00:00:10:00
    expect(edl).toContain('00:00:10:00');
  });

  it('includes AI comment if summary is present', () => {
    const edl = exportEdl([makeSegment({ ai_summary: 'Beautiful sunset' })], OPTIONS);
    expect(edl).toContain('* COMMENT: Beautiful sunset');
  });
});
