import { describe, it, expect } from 'vitest';
import { exportFcpxml } from '../../../../src/core/export/fcpxml.js';
import type { ExportSegment, ExportOptions } from '../../../../src/types/export.js';
import { assertFcpxmlValid } from './_helpers.js';

const OPTIONS: ExportOptions = { title: 'Mallorca 2025', fps: 25, format: 'fcpxml' };

function makeSegment(overrides: Partial<ExportSegment> = {}): ExportSegment {
  return {
    position: 1,
    clip_id: 1,
    file_path: '/videos/beach.mp4',
    file_name: 'beach.mp4',
    duration_sec: 30,
    start_sec: 0,
    end_sec: 15,
    fps: 25,
    nb_frames: 750, // 30s × 25fps
    start_timecode: null,
    has_video: true,
    has_audio: true,
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

  it('passes all structural invariants', () => {
    const s = makeSegment();
    const xml = exportFcpxml([s], OPTIONS);
    assertFcpxmlValid(xml, [s], 25);
  });

  it('contains resources section with format and assets', () => {
    const xml = exportFcpxml([makeSegment()], OPTIONS);
    expect(xml).toContain('<resources>');
    expect(xml).toContain('<format');
    expect(xml).toContain('<asset');
    expect(xml).toContain('</resources>');
  });

  it('uses canonical 25fps frame duration', () => {
    const xml = exportFcpxml([makeSegment()], OPTIONS);
    expect(xml).toContain('frameDuration="100/2500s"');
  });

  it('references original file paths as valid file:// URIs', () => {
    const xml = exportFcpxml([makeSegment({ file_path: '/originals/beach_4k.mp4' })], OPTIONS);
    expect(xml).toContain('file:///originals/beach_4k.mp4');
  });

  it('URL-encodes spaces in file paths (parens are valid unreserved URI chars)', () => {
    const xml = exportFcpxml([makeSegment({ file_path: '/footage/B-roll (Take 2).mp4' })], OPTIONS);
    // Spaces must be percent-encoded; parens are valid unreserved chars (RFC 3986)
    expect(xml).toContain('B-roll%20');
    expect(xml).not.toContain('B-roll (Take 2)');
    // The URI must be parseable
    const uriMatch = xml.match(/src="(file:\/\/[^"]+)"/);
    expect(uriMatch).not.toBeNull();
    expect(() => new URL(uriMatch![1])).not.toThrow();
  });

  it('includes library/event/project/sequence/spine structure', () => {
    const xml = exportFcpxml([makeSegment()], OPTIONS);
    expect(xml).toContain('<library>');
    expect(xml).toContain('<event');
    expect(xml).toContain('<project');
    expect(xml).toContain('<sequence');
    expect(xml).toContain('<spine>');
  });

  it('includes clip elements in spine with correct ref', () => {
    const xml = exportFcpxml([makeSegment()], OPTIONS);
    expect(xml).toContain('<clip');
    expect(xml).toContain('ref="r1"');
  });

  it('asset duration equals full source nb_frames (not trimmed)', () => {
    // nb_frames = 750 (30s), but we only use 15s of the clip
    const xml = exportFcpxml([makeSegment({ start_sec: 0, end_sec: 15, nb_frames: 750 })], OPTIONS);
    // Asset duration = 750 frames at 25fps = 750*100/2500s = "75000/2500s"
    expect(xml).toContain('duration="75000/2500s"');
  });

  it('escapes XML special characters in title', () => {
    const xml = exportFcpxml([makeSegment()], { ...OPTIONS, title: 'Test & "Quotes" <Tags>' });
    expect(xml).toContain('Test &amp; &quot;Quotes&quot; &lt;Tags&gt;');
  });

  it('handles multiple segments with correct refs', () => {
    const xml = exportFcpxml([
      makeSegment({ position: 1 }),
      makeSegment({ position: 2, clip_id: 2, file_name: 'sunset.mp4', file_path: '/videos/sunset.mp4' }),
    ], OPTIONS);

    expect(xml).toContain('ref="r1"');
    expect(xml).toContain('ref="r2"');
  });

  it('multiple segments pass structural invariants', () => {
    const segs = [
      makeSegment({ position: 1 }),
      makeSegment({ position: 2, clip_id: 2, file_name: 'sunset.mp4', file_path: '/videos/sunset.mp4' }),
    ];
    const xml = exportFcpxml(segs, OPTIONS);
    assertFcpxmlValid(xml, segs, 25);
  });

  it('hasVideo=0 for audio-only clip', () => {
    const xml = exportFcpxml([makeSegment({ has_video: false, has_audio: true })], OPTIONS);
    expect(xml).toContain('hasVideo="0"');
    expect(xml).toContain('hasAudio="1"');
  });

  it('throws on mixed frame rates', () => {
    const segs = [
      makeSegment({ fps: 25 }),
      makeSegment({ position: 2, clip_id: 2, fps: 30, file_path: '/videos/other.mp4', file_name: 'other.mp4' }),
    ];
    expect(() => exportFcpxml(segs, OPTIONS)).toThrow(/mixed frame rate/i);
  });
});
