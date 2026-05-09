import type { ExportSegment, ExportOptions } from '../../types/export.js';
import { secondsToTimecode, timecodeToSeconds } from '../../utils/timecode.js';
import path from 'node:path';

/**
 * Sanitize a filename into a CMX 3600 reel name:
 * alphanumeric + underscore only, max 32 chars, no leading underscore.
 */
function toReelName(filePath: string): string {
  const base = path.parse(filePath).name;
  const sanitized = base
    .replace(/[^A-Za-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_/, '')
    .substring(0, 32);
  return sanitized || 'CLIP';
}

/** Strip newlines and control characters that would break EDL line structure. */
function sanitizeComment(text: string, maxLen = 200): string {
  return text.replace(/[\r\n\t|]+/g, ' ').trim().substring(0, maxLen);
}

export function exportEdl(segments: ExportSegment[], options: ExportOptions): string {
  const fps = options.fps;
  const lines: string[] = [
    `TITLE: ${options.title}`,
    'FCM: NON-DROP FRAME',
    '',
  ];

  let recordPosition = 0; // Running record timecode position in seconds

  for (const seg of segments) {
    const eventNum = String(seg.position).padStart(3, '0');
    const reelName = toReelName(seg.file_path);

    const clipFps = seg.fps || fps;
    const tcBaseFrames = seg.start_timecode
      ? Math.round(timecodeToSeconds(seg.start_timecode, clipFps) * clipFps)
      : 0;
    const startFrames = tcBaseFrames + Math.round(seg.start_sec * clipFps);
    const endFrames = (seg.nb_frames != null)
      ? tcBaseFrames + seg.nb_frames - 1
      : tcBaseFrames + Math.round(seg.end_sec * clipFps);
    const srcIn = secondsToTimecode(startFrames / clipFps, clipFps);
    const srcOut = secondsToTimecode(endFrames / clipFps, clipFps);
    const recIn = secondsToTimecode(recordPosition, clipFps);
    const segDuration = (endFrames - startFrames) / clipFps;
    const recOut = secondsToTimecode(recordPosition + segDuration, clipFps);

    lines.push(`${eventNum}  ${reelName}  V  C        ${srcIn} ${srcOut} ${recIn} ${recOut}`);
    lines.push(`* FROM CLIP NAME: ${path.basename(seg.file_path)}`);
    lines.push(`* SOURCE FILE: ${seg.file_path}`);

    if (seg.ai_summary) {
      lines.push(`* COMMENT: ${sanitizeComment(seg.ai_summary)}`);
    }

    lines.push('');
    recordPosition += segDuration;
  }

  return lines.join('\n');
}
