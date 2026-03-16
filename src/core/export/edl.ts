import type { ExportSegment, ExportOptions } from '../../types/export.js';
import { secondsToTimecode } from '../../utils/timecode.js';
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
    const reelName = `CLIP${String(seg.clip_id).padStart(4, '0')}`;

    const srcIn = secondsToTimecode(seg.start_sec, fps);
    const srcOut = secondsToTimecode(seg.end_sec, fps);
    const recIn = secondsToTimecode(recordPosition, fps);
    const segDuration = seg.end_sec - seg.start_sec;
    const recOut = secondsToTimecode(recordPosition + segDuration, fps);

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
