import { describe, it, expect } from 'vitest';
import { exportEdl } from '../../../../src/core/export/edl.js';
import type { ExportSegment, ExportOptions } from '../../../../src/types/export.js';
import { assertEdlValid } from './_helpers.js';

const OPTIONS: ExportOptions = { title: 'Mallorca 2025', fps: 25, format: 'edl' };

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
    nb_frames: 375, // 15s × 25fps
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

describe('exportEdl', () => {
  it('starts with TITLE and FCM', () => {
    const edl = exportEdl([makeSegment()], OPTIONS);
    expect(edl).toContain('TITLE: Mallorca 2025');
    expect(edl).toContain('FCM: NON-DROP FRAME');
  });

  it('passes all structural invariants', () => {
    const s = makeSegment();
    const edl = exportEdl([s], OPTIONS);
    assertEdlValid(edl, [s], 25);
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

  it('source-out is nb_frames-1 at 25fps (stays within clip bounds)', () => {
    // nb_frames=375 → source-out frame = 374 = 14 seconds + 24 frames at 25fps
    // 374 / 25 = 14.96s → 00:00:14:24
    const edl = exportEdl([makeSegment()], OPTIONS);
    expect(edl).toContain('00:00:14:24');
  });

  it('chain record positions for multiple segments', () => {
    const segments = [
      makeSegment({ position: 1, nb_frames: 250, start_sec: 0, end_sec: 10 }),
      makeSegment({ position: 2, clip_id: 2, nb_frames: 375, start_sec: 0, end_sec: 15 }),
    ];
    const edl = exportEdl(segments, OPTIONS);
    assertEdlValid(edl, segments, 25);
  });

  it('sanitizes reel name — no spaces or special chars', () => {
    const edl = exportEdl([makeSegment({ file_path: '/footage/B-roll (Take 2).mov' })], OPTIONS);
    // Reel name must match alphanumeric+underscore only
    const lines = edl.split('\n');
    const eventLine = lines.find(l => /^\d{3}/.test(l));
    expect(eventLine).toBeDefined();
    const reelName = eventLine!.split(/\s+/)[1];
    expect(reelName).toMatch(/^[A-Za-z0-9_]+$/);
  });

  it('strips newlines from AI summary comment', () => {
    const edl = exportEdl([makeSegment({ ai_summary: 'Line one\nLine two' })], OPTIONS);
    const lines = edl.split('\n');
    const commentLine = lines.find(l => l.startsWith('* COMMENT:'));
    expect(commentLine).toBeDefined();
    expect(commentLine).not.toContain('\n');
    expect(commentLine).toContain('Line one Line two');
  });

  it('includes AI comment if summary is present', () => {
    const edl = exportEdl([makeSegment({ ai_summary: 'Beautiful sunset' })], OPTIONS);
    expect(edl).toContain('* COMMENT: Beautiful sunset');
  });
});
