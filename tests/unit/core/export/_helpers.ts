import { expect } from 'vitest';
import type { ExportSegment } from '../../../../src/types/export.js';
import { frameDurationFor } from '../../../../src/core/export/fcpxml-rates.js';

// ---------------------------------------------------------------------------
// FCPXML structural invariant checker
// ---------------------------------------------------------------------------

export function assertFcpxmlValid(xml: string, segments: ExportSegment[], fps: number): void {
  // 1. XML declaration
  expect(xml, 'missing XML declaration').toMatch(/^<\?xml version="1\.0"/);

  // 2. FCPXML version
  expect(xml, 'wrong or missing fcpxml version').toContain('fcpxml version="1.8"');

  // 3. Collect all defined IDs (format + assets)
  const definedIds = new Set<string>();
  for (const m of xml.matchAll(/\bid="(r\d+)"/g)) definedIds.add(m[1]);

  // 4. Every clip ref resolves
  for (const m of xml.matchAll(/\bref="(r\d+)"/g)) {
    expect(definedIds, `clip ref="${m[1]}" has no matching asset`).toContain(m[1]);
  }

  // 5. Every asset format ref resolves
  for (const m of xml.matchAll(/<asset[^>]+format="(r\d+)"/g)) {
    expect(definedIds, `asset format="${m[1]}" has no matching format`).toContain(m[1]);
  }

  // 6. file:// URIs are valid
  for (const m of xml.matchAll(/src="(file:\/\/[^"]+)"/g)) {
    const rawUri = m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"');
    expect(() => new URL(rawUri), `invalid file URI: ${rawUri}`).not.toThrow();
  }

  // 7. No unescaped bare & or < inside attribute values (basic check)
  // Attribute values are between ="..." — strip known entities first
  const stripped = xml.replace(/&(?:amp|lt|gt|quot|apos);/g, 'X');
  const attrValues = stripped.matchAll(/="([^"]*)"/g);
  for (const m of attrValues) {
    expect(m[1], `unescaped & or < in attribute value: ${m[1]}`).not.toMatch(/[&<]/);
  }

  // 8. All rationals use canonical form for the fps
  const { num, den } = frameDurationFor(fps);
  // The frameDuration on the format element should match the canonical rational
  expect(xml, `frameDuration should be canonical ${num}/${den}s for ${fps}fps`).toContain(
    `frameDuration="${num}/${den}s"`,
  );

  // 9. Sequence duration equals sum of clip durations (extract from spine)
  // Parse clip durations from spine
  const clipDurationMatches = [...xml.matchAll(/<clip[^>]+duration="(\d+)\/(\d+)s"/g)];
  if (clipDurationMatches.length > 0) {
    const totalNumerator = clipDurationMatches.reduce(
      (sum, m) => sum + parseInt(m[1], 10),
      0,
    );
    const spineDen = parseInt(clipDurationMatches[0][2], 10);
    const seqMatch = xml.match(/<sequence[^>]+duration="(\d+)\/(\d+)s"/);
    if (seqMatch) {
      const seqNum = parseInt(seqMatch[1], 10);
      const seqDen = parseInt(seqMatch[2], 10);
      // Convert to common denominator for comparison
      expect(
        totalNumerator * seqDen,
        'sum of clip durations must equal sequence duration',
      ).toBe(seqNum * spineDen);
    }
  }
}

// ---------------------------------------------------------------------------
// EDL structural invariant checker
// ---------------------------------------------------------------------------

// CMX 3600 event line: NNN  REELNAME  V  C  HH:MM:SS:FF HH:MM:SS:FF HH:MM:SS:FF HH:MM:SS:FF
const EDL_EVENT_RE = /^(\d{3})\s+(\S+)\s+V\s+C\s+([\d:]+)\s+([\d:]+)\s+([\d:]+)\s+([\d:]+)/;
const TC_RE = /^\d{2}:\d{2}:\d{2}:\d{2}$/;

export function assertEdlValid(text: string, segments: ExportSegment[], fps: number): void {
  const lines = text.split('\n');

  // 1. Starts with TITLE and FCM
  expect(lines[0], 'EDL must start with TITLE').toMatch(/^TITLE:/);
  expect(lines[1], 'EDL must have FCM line').toMatch(/^FCM:/);

  // 2. Every comment line has no internal newline (trivially true after split, but check no bare CR)
  for (const line of lines) {
    if (line.startsWith('*')) {
      expect(line, 'comment line must not contain carriage return').not.toContain('\r');
    }
  }

  // 3. Reel names are alphanumeric+underscore, ≤ 32 chars
  for (const line of lines) {
    const m = line.match(EDL_EVENT_RE);
    if (!m) continue;
    const reel = m[2];
    expect(reel, `reel name "${reel}" contains invalid characters`).toMatch(/^[A-Za-z0-9_]+$/);
    expect(reel.length, `reel name "${reel}" exceeds 32 chars`).toBeLessThanOrEqual(32);
  }

  // 4. All TC strings match HH:MM:SS:FF
  for (const line of lines) {
    const m = line.match(EDL_EVENT_RE);
    if (!m) continue;
    for (const tc of [m[3], m[4], m[5], m[6]]) {
      expect(tc, `malformed timecode "${tc}"`).toMatch(TC_RE);
    }
  }

  // 5. For segments with nb_frames: source-out must be < tcBase + nb_frames
  //    (the nb_frames-1 trim must be in effect)
  const eventLines = lines.filter(l => EDL_EVENT_RE.test(l));
  for (let i = 0; i < segments.length && i < eventLines.length; i++) {
    const seg = segments[i];
    if (seg.nb_frames == null) continue;
    const m = eventLines[i].match(EDL_EVENT_RE)!;
    const srcOut = m[4]; // HH:MM:SS:FF
    const clipFps = seg.fps || fps;
    const srcOutParts = srcOut.split(':').map(Number);
    const srcOutFrames =
      ((srcOutParts[0] * 3600 + srcOutParts[1] * 60 + srcOutParts[2]) * Math.round(clipFps)) +
      srcOutParts[3];
    // Compute TC base frames (the frame number where the source media starts in TC space)
    let tcBaseFrames = 0;
    if (seg.start_timecode) {
      const tcParts = seg.start_timecode.split(':').map(Number);
      tcBaseFrames =
        ((tcParts[0] * 3600 + tcParts[1] * 60 + tcParts[2]) * Math.round(clipFps)) + tcParts[3];
    }
    // srcOutFrames should be < tcBaseFrames + nb_frames (exclusive upper bound)
    expect(
      srcOutFrames,
      `source-out frame ${srcOutFrames} must be < tcBase(${tcBaseFrames}) + nb_frames(${seg.nb_frames})`,
    ).toBeLessThan(tcBaseFrames + seg.nb_frames);
  }

  // 6. Record-in of event N+1 equals record-out of event N
  for (let i = 0; i + 1 < eventLines.length; i++) {
    const cur = eventLines[i].match(EDL_EVENT_RE)!;
    const next = eventLines[i + 1].match(EDL_EVENT_RE)!;
    expect(next[5], `record gap between events ${i + 1} and ${i + 2}`).toBe(cur[6]);
  }
}
