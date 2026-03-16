import { describe, it, expect } from 'vitest';
import { exportJson } from '../../../../src/core/export/json.js';
import type { ExportSegment, ExportOptions } from '../../../../src/types/export.js';

const OPTIONS: ExportOptions = { title: 'Mallorca 2025', fps: 30, format: 'json' };

function makeSegment(overrides: Partial<ExportSegment> = {}): ExportSegment {
  return {
    position: 1,
    clip_id: 1,
    file_path: '/videos/beach.mp4',
    file_name: 'beach.mp4',
    duration_sec: 30,
    start_sec: 5,
    end_sec: 20,
    fps: 30,
    resolution: '1920x1080',
    ai_summary: 'Beach scene',
    ai_quality_overall: 3.5,
    segment_role: 'intro',
    notes: null,
    ...overrides,
  };
}

describe('exportJson', () => {
  it('produces valid JSON', () => {
    const json = exportJson([makeSegment()], OPTIONS);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('includes title', () => {
    const parsed = JSON.parse(exportJson([makeSegment()], OPTIONS));
    expect(parsed.title).toBe('Mallorca 2025');
  });

  it('computes total_duration_sec', () => {
    const parsed = JSON.parse(exportJson([
      makeSegment({ start_sec: 0, end_sec: 10 }),
      makeSegment({ position: 2, start_sec: 5, end_sec: 20 }),
    ], OPTIONS));
    expect(parsed.total_duration_sec).toBe(25); // 10 + 15
  });

  it('includes original file paths', () => {
    const parsed = JSON.parse(exportJson([makeSegment()], OPTIONS));
    expect(parsed.segments[0].file_path).toBe('/videos/beach.mp4');
  });

  it('includes computed duration per segment', () => {
    const parsed = JSON.parse(exportJson([makeSegment({ start_sec: 5, end_sec: 20 })], OPTIONS));
    expect(parsed.segments[0].duration_sec).toBe(15);
  });
});
