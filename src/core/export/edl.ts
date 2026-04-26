import type { ExportSegment, ExportOptions } from '../../types/export.js';
import { secondsToTimecode, timecodeToSeconds } from '../../utils/timecode.js';
import path from 'node:path';

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
    const reelName = path.parse(seg.file_path).name.substring(0, 32);

    const clipFps = seg.fps || fps;
    const tcBaseFrames = seg.start_timecode
      ? Math.round(timecodeToSeconds(seg.start_timecode, clipFps) * clipFps)
      : 0;
    const startFrames = tcBaseFrames + Math.round(seg.start_sec * clipFps);
    const endFrames = (seg.nb_frames != null)
      ? tcBaseFrames + seg.nb_frames
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
      lines.push(`* COMMENT: ${seg.ai_summary.slice(0, 200)}`);
    }

    lines.push('');
    recordPosition += segDuration;
  }

  return lines.join('\n');
}
