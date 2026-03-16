import { describe, it, expect } from 'vitest';
import { exportFcpxml } from '../../../../src/core/export/fcpxml.js';
import type { ExportSegment, ExportOptions } from '../../../../src/types/export.js';

const OPTIONS: ExportOptions = { title: 'Mallorca 2025', fps: 30, format: 'fcpxml' };

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

describe('exportFcpxml', () => {
  it('produces valid XML declaration', () => {
    const xml = exportFcpxml([makeSegment()], OPTIONS);
    expect(xml).toMatch(/^<\?xml version="1\.0"/);
  });

  it('uses FCPXML version 1.8', () => {
    const xml = exportFcpxml([makeSegment()], OPTIONS);
    expect(xml).toContain('fcpxml version="1.8"');
  });

  it('contains resources section with assets', () => {
    const xml = exportFcpxml([makeSegment()], OPTIONS);
    expect(xml).toContain('<resources>');
    expect(xml).toContain('<asset');
    expect(xml).toContain('</resources>');
  });

  it('references original file paths', () => {
    const xml = exportFcpxml([makeSegment({ file_path: '/originals/beach_4k.mp4' })], OPTIONS);
    expect(xml).toContain('file:///originals/beach_4k.mp4');
  });

  it('includes library/event/project/sequence/spine structure', () => {
    const xml = exportFcpxml([makeSegment()], OPTIONS);
    expect(xml).toContain('<library>');
    expect(xml).toContain('<event');
    expect(xml).toContain('<project');
    expect(xml).toContain('<sequence');
    expect(xml).toContain('<spine>');
  });

  it('includes clip elements in spine', () => {
    const xml = exportFcpxml([makeSegment()], OPTIONS);
    expect(xml).toContain('<clip');
    expect(xml).toContain('ref="r1"');
  });

  it('escapes XML special characters in title', () => {
    const xml = exportFcpxml([makeSegment()], { ...OPTIONS, title: 'Test & "Quotes" <Tags>' });
    expect(xml).toContain('Test &amp; &quot;Quotes&quot; &lt;Tags&gt;');
  });

  it('handles multiple segments', () => {
    const xml = exportFcpxml([
      makeSegment({ position: 1 }),
      makeSegment({ position: 2, clip_id: 2, file_name: 'sunset.mp4' }),
    ], OPTIONS);

    expect(xml).toContain('ref="r1"');
    expect(xml).toContain('ref="r2"');
  });
});
