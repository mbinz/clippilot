import { describe, it, expect } from 'vitest';
import { exportCsv } from '../../../../src/core/export/csv.js';
import type { ExportSegment, ExportOptions } from '../../../../src/types/export.js';

const OPTIONS: ExportOptions = { title: 'Test', fps: 30, format: 'csv' };

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

describe('exportCsv', () => {
  it('produces correct header', () => {
    const csv = exportCsv([makeSegment()], OPTIONS);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('position,clip_id,file_path,file_name,start_sec,end_sec,duration_sec,quality,role,summary');
  });

  it('produces correct data row', () => {
    const csv = exportCsv([makeSegment()], OPTIONS);
    const lines = csv.split('\n');
    expect(lines[1]).toContain('/videos/beach.mp4');
    expect(lines[1]).toContain('beach.mp4');
    expect(lines[1]).toContain('3.5');
  });

  it('escapes commas in fields', () => {
    const csv = exportCsv([makeSegment({ ai_summary: 'Beach, sunset, waves' })], OPTIONS);
    expect(csv).toContain('"Beach, sunset, waves"');
  });

  it('escapes quotes in fields', () => {
    const csv = exportCsv([makeSegment({ ai_summary: 'A "great" shot' })], OPTIONS);
    expect(csv).toContain('"A ""great"" shot"');
  });

  it('uses original file path, not proxy', () => {
    const csv = exportCsv([makeSegment({ file_path: '/originals/4k_beach.mp4' })], OPTIONS);
    expect(csv).toContain('/originals/4k_beach.mp4');
  });

  it('handles multiple segments', () => {
    const csv = exportCsv([
      makeSegment({ position: 1 }),
      makeSegment({ position: 2, clip_id: 2 }),
    ], OPTIONS);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(3); // header + 2 rows
  });
});
