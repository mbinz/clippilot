/**
 * Regression tests seeded from the real user bug report:
 * 25fps source clips with embedded TC, exported via story path.
 * Some clips went offline in DaVinci Resolve because:
 *   - EDL: nb_frames was null in story exports → source-out could land past end of media
 *   - FCPXML: global fps=30 default → all rationals on 30fps grid, not 25fps
 *
 * These tests are written so that the current (broken) code FAILS them,
 * and the fixed code PASSES them. Run `pnpm test` to verify.
 */
import { describe, it, expect } from 'vitest';
import { exportEdl } from '../../../../src/core/export/edl.js';
import { exportFcpxml } from '../../../../src/core/export/fcpxml.js';
import type { ExportSegment, ExportOptions } from '../../../../src/types/export.js';
import { assertEdlValid, assertFcpxmlValid } from './_helpers.js';

const FPS = 25;
const OPTIONS_EDL: ExportOptions = { title: 'Regression', fps: FPS, format: 'edl' };
const OPTIONS_FCPXML: ExportOptions = { title: 'Regression', fps: FPS, format: 'fcpxml' };

function seg(overrides: Partial<ExportSegment> = {}): ExportSegment {
  return {
    position: 1,
    clip_id: 1,
    file_path: '/footage/clip_A.mov',
    file_name: 'clip_A.mov',
    duration_sec: 10,
    start_sec: 0,
    end_sec: 10,
    fps: FPS,
    nb_frames: 250, // 10s × 25fps
    start_timecode: null,
    has_video: true,
    has_audio: true,
    resolution: '1920x1080',
    ai_summary: null,
    ai_quality_overall: null,
    segment_role: null,
    notes: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// EDL regression: nb_frames-1 trim for story-exported segments
// ---------------------------------------------------------------------------
describe('EDL regression: source-out stays within clip bounds', () => {
  it('source-out is nb_frames-1 (not nb_frames), preventing offline clips', () => {
    // end_sec = duration_sec = 10s → rawEndFrames = 250 = nb_frames
    // Without fix: source-out = frame 250 → one past last valid frame (249)
    // With fix:    source-out = nb_frames - 1 = frame 249 ✓
    const s = seg({ start_sec: 0, end_sec: 10, nb_frames: 250 });
    const edl = exportEdl([s], OPTIONS_EDL);
    assertEdlValid(edl, [s], FPS);
    // Source-out TC at 25fps: frame 249 = 00:00:09:24
    expect(edl).toContain('00:00:09:24');
  });

  it('handles timecode offset clips correctly', () => {
    // TC starts at 01:00:00:00 = frame 90000 at 25fps
    // Segment: start_sec=0, end_sec=5, nb_frames=125
    // Source-out should be: 90000 + 125 - 1 = 90124 = 01:00:05:24 ... wait
    // Actually tcBase = 90000, startFrames = 90000 + 0 = 90000 (00:00:00:00 into clip)
    // endFrames = 90000 + 125 - 1 = 90124
    // srcIn = secondsToTimecode(90000/25) = secondsToTimecode(3600) = 01:00:00:00
    // srcOut = secondsToTimecode(90124/25) = 01:00:04:24
    const s = seg({
      start_sec: 0, end_sec: 5, nb_frames: 125,
      start_timecode: '01:00:00:00',
    });
    const edl = exportEdl([s], OPTIONS_EDL);
    assertEdlValid(edl, [s], FPS);
    expect(edl).toContain('01:00:00:00'); // src in
    expect(edl).toContain('01:00:04:24'); // src out = frame 90124/25 = 3604.96s → 01:00:04:24
  });

  it('ai_summary with newlines does not break EDL structure', () => {
    const s = seg({ ai_summary: 'First line\nSecond line\r\nThird line' });
    const edl = exportEdl([s], OPTIONS_EDL);
    // The summary must not introduce extra event lines or malformed records
    assertEdlValid(edl, [s], FPS);
    expect(edl).toContain('* COMMENT: First line Second line');
  });

  it('reel name is sanitized to alphanumeric+underscore', () => {
    const s = seg({ file_path: '/footage/B-roll (Take 2) — Wide Shot.mov' });
    const edl = exportEdl([s], OPTIONS_EDL);
    assertEdlValid(edl, [s], FPS);
    // Reel name must not contain spaces, hyphens, parens, or em-dash
    expect(edl).not.toMatch(/^(\d{3})\s+[^A-Za-z0-9_\s]/m);
  });

  it('three-clip story: record-in of each event equals record-out of previous', () => {
    const clips = [
      seg({ position: 1, clip_id: 1, nb_frames: 125, end_sec: 5 }),
      seg({ position: 2, clip_id: 2, file_path: '/footage/clip_B.mov', file_name: 'clip_B.mov', nb_frames: 175, end_sec: 7 }),
      seg({ position: 3, clip_id: 3, file_path: '/footage/clip_C.mov', file_name: 'clip_C.mov', nb_frames: 250, end_sec: 10 }),
    ];
    const edl = exportEdl(clips, OPTIONS_EDL);
    assertEdlValid(edl, clips, FPS);
  });
});

// ---------------------------------------------------------------------------
// FCPXML regression: 25fps clips must not be on a 30fps grid
// ---------------------------------------------------------------------------
describe('FCPXML regression: 25fps source clips on 25fps timeline', () => {
  it('format frameDuration is 100/2500s (not 1000/30000s)', () => {
    const s = seg();
    const xml = exportFcpxml([s], OPTIONS_FCPXML);
    assertFcpxmlValid(xml, [s], FPS);
    expect(xml).toContain('frameDuration="100/2500s"');
    expect(xml).not.toContain('30000');
  });

  it('fractional start_sec values land on 25fps frame boundaries', () => {
    // 0.04s = 1 frame at 25fps. Would be 1.2 frames at 30fps → fractional → offline.
    const s = seg({ start_sec: 0.04, end_sec: 5.04 });
    const xml = exportFcpxml([s], OPTIONS_FCPXML);
    assertFcpxmlValid(xml, [s], FPS);
    // start="1/2500s" not "1200/30000s"
    // At 25fps: 0.04s = 1 frame → timeAttr(1, 25) = "100/2500s"
    expect(xml).toContain('start="100/2500s"');
  });

  it('asset duration equals full source nb_frames (not trimmed segment)', () => {
    // Clip is 10s/250 frames but we only use 5s of it
    const s = seg({ start_sec: 2, end_sec: 7, nb_frames: 250 });
    const xml = exportFcpxml([s], OPTIONS_FCPXML);
    assertFcpxmlValid(xml, [s], FPS);
    // Asset duration = 250 frames → 250*100/2500s = "25000/2500s"
    expect(xml).toContain('duration="25000/2500s"');
  });

  it('file path with spaces and parens produces valid URI', () => {
    const s = seg({ file_path: '/Volumes/Footage/B-roll (Take 2).mov' });
    const xml = exportFcpxml([s], OPTIONS_FCPXML);
    assertFcpxmlValid(xml, [s], FPS);
    // Spaces must be percent-encoded; parens are valid unreserved URI chars
    expect(xml).not.toContain('B-roll (Take 2)');
    expect(xml).toContain('B-roll%20');
  });

  it('has_video=false produces hasVideo="0"', () => {
    const s = seg({ has_video: false, has_audio: true });
    const xml = exportFcpxml([s], OPTIONS_FCPXML);
    expect(xml).toContain('hasVideo="0"');
    expect(xml).toContain('hasAudio="1"');
  });

  it('three-clip story: sum of clip durations equals sequence duration', () => {
    const clips = [
      seg({ position: 1, clip_id: 1, nb_frames: 125, start_sec: 0, end_sec: 5 }),
      seg({ position: 2, clip_id: 2, file_path: '/f/b.mov', file_name: 'b.mov', nb_frames: 175, start_sec: 0, end_sec: 7 }),
      seg({ position: 3, clip_id: 3, file_path: '/f/c.mov', file_name: 'c.mov', nb_frames: 250, start_sec: 0, end_sec: 10 }),
    ];
    const xml = exportFcpxml(clips, OPTIONS_FCPXML);
    assertFcpxmlValid(xml, clips, FPS);
  });

  it('throws on mixed frame rates', () => {
    const clips = [
      seg({ fps: 25 }),
      seg({ position: 2, clip_id: 2, fps: 30, file_path: '/f/b.mov', file_name: 'b.mov' }),
    ];
    expect(() => exportFcpxml(clips, OPTIONS_FCPXML)).toThrow(/mixed frame rate/i);
  });
});
