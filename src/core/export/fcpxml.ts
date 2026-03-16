import type { ExportSegment, ExportOptions } from '../../types/export.js';
import path from 'node:path';

export function exportFcpxml(segments: ExportSegment[], options: ExportOptions): string {
  const fps = options.fps;
  const fpsNum = Math.round(fps * 1000);
  const fpsDen = 1000;
  const frameDuration = `${fpsDen}/${fpsNum}s`;

  const resources = segments.map((seg, i) => {
    const assetId = `r${i + 1}`;
    const formatId = `r${segments.length + 1}`;
    const durationFrac = `${Math.round(seg.duration_sec * fpsNum)}/${fpsNum}s`;
    const fileSrc = `file://${seg.file_path}`;

    return `        <asset id="${assetId}" name="${xmlEscape(seg.file_name)}" start="0s" duration="${durationFrac}" hasVideo="1" hasAudio="1">
            <media-rep kind="original-media" src="${xmlEscape(fileSrc)}"/>
        </asset>`;
  }).join('\n');

  let offset = 0;
  const clips = segments.map((seg, i) => {
    const assetId = `r${i + 1}`;
    const startFrac = `${Math.round(seg.start_sec * fpsNum)}/${fpsNum}s`;
    const durationFrac = `${Math.round((seg.end_sec - seg.start_sec) * fpsNum)}/${fpsNum}s`;
    const offsetFrac = `${Math.round(offset * fpsNum)}/${fpsNum}s`;

    const clip = `                <clip name="${xmlEscape(seg.file_name)}" ref="${assetId}" offset="${offsetFrac}" start="${startFrac}" duration="${durationFrac}"/>`;

    offset += seg.end_sec - seg.start_sec;
    return clip;
  }).join('\n');

  const totalDuration = segments.reduce((sum, s) => sum + (s.end_sec - s.start_sec), 0);
  const totalDurationFrac = `${Math.round(totalDuration * fpsNum)}/${fpsNum}s`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.8">
    <resources>
        <format id="r0" name="FFVideoFormat${Math.round(fps)}p" frameDuration="${frameDuration}"/>
${resources}
    </resources>
    <library>
        <event name="${xmlEscape(options.title)}">
            <project name="${xmlEscape(options.title)}">
                <sequence format="r0" duration="${totalDurationFrac}">
                    <spine>
${clips}
                    </spine>
                </sequence>
            </project>
        </event>
    </library>
</fcpxml>`;
}

function xmlEscape(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
