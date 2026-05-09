import type { ExportSegment, ExportOptions } from '../../types/export.js';
import { timecodeToSeconds } from '../../utils/timecode.js';
import { pathToFileUri } from '../../utils/fs.js';
import { frameDurationFor, timeAttr } from './fcpxml-rates.js';

export function exportFcpxml(segments: ExportSegment[], options: ExportOptions): string {
  if (segments.length === 0) {
    throw new Error('Cannot export an empty segment list.');
  }

  const timelineFps = options.fps;

  // Validate all clips share the timeline fps (CLI should have caught this already)
  for (const seg of segments) {
    if (seg.fps > 0 && Math.abs(seg.fps - timelineFps) > 0.1) {
      throw new Error(
        `Clip "${seg.file_name}" has fps ${seg.fps} but timeline fps is ${timelineFps}. ` +
        `Mixed frame rates are not supported.`,
      );
    }
  }

  const { num: fmtNum, den: fmtDen } = frameDurationFor(timelineFps);
  const frameDuration = `${fmtNum}/${fmtDen}s`;
  const fpsLabel = Math.round(timelineFps);

  // Build resource IDs: r0 = format, r1..rN = assets
  const formatId = 'r0';

  const resourceLines: string[] = [];

  // Format element (timeline fps)
  resourceLines.push(
    `        <format id="${formatId}" name="FFVideoFormat${fpsLabel}p" frameDuration="${frameDuration}"/>`,
  );

  // Asset elements — duration is the FULL source clip extent, not the trimmed segment
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const assetId = `r${i + 1}`;
    const clipFps = seg.fps > 0 ? seg.fps : timelineFps;

    // Asset start reflects embedded timecode (the "start of media" in source TC space)
    const tcBaseFrames = seg.start_timecode
      ? Math.round(timecodeToSeconds(seg.start_timecode, clipFps) * clipFps)
      : 0;
    const assetStartAttr = tcBaseFrames > 0 ? timeAttr(tcBaseFrames, clipFps) : '0s';

    // Asset duration = full source media extent
    const fullFrames = seg.nb_frames != null
      ? seg.nb_frames
      : Math.round(seg.duration_sec * clipFps);
    const assetDurationAttr = timeAttr(fullFrames, clipFps);

    const uri = xmlEscape(pathToFileUri(seg.file_path));
    const hasVideo = seg.has_video ? '1' : '0';
    const hasAudio = seg.has_audio ? '1' : '0';

    resourceLines.push(
      `        <asset id="${assetId}" name="${xmlEscape(seg.file_name)}" ` +
      `start="${assetStartAttr}" duration="${assetDurationAttr}" ` +
      `format="${formatId}" hasVideo="${hasVideo}" hasAudio="${hasAudio}">` +
      `\n            <media-rep kind="original-media" src="${uri}"/>` +
      `\n        </asset>`,
    );
  }

  // Spine clips — offset advances in timeline fps, start/duration in clip fps
  const clipLines: string[] = [];
  let timelineFrames = 0; // running offset in timeline frames

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const assetId = `r${i + 1}`;
    const clipFps = seg.fps > 0 ? seg.fps : timelineFps;

    const tcBaseFrames = seg.start_timecode
      ? Math.round(timecodeToSeconds(seg.start_timecode, clipFps) * clipFps)
      : 0;

    const startFrames = tcBaseFrames + Math.round(seg.start_sec * clipFps);
    const rawEndFrames = Math.round(seg.end_sec * clipFps);
    // Trim 1 frame to stay in-bounds (mirrors EDL fix from commit 35b50dc)
    const endFrames = seg.nb_frames != null
      ? Math.min(tcBaseFrames + seg.nb_frames - 1, tcBaseFrames + rawEndFrames)
      : tcBaseFrames + rawEndFrames;
    const durationFrames = endFrames - startFrames;

    const offsetAttr = timeAttr(timelineFrames, timelineFps);
    const startAttr = timeAttr(startFrames, clipFps);
    const durationAttr = timeAttr(durationFrames, clipFps);

    clipLines.push(
      `                <clip name="${xmlEscape(seg.file_name)}" ref="${assetId}" ` +
      `offset="${offsetAttr}" start="${startAttr}" duration="${durationAttr}"/>`,
    );

    timelineFrames += durationFrames;
  }

  const totalDurationAttr = timeAttr(timelineFrames, timelineFps);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.8">
    <resources>
${resourceLines.join('\n')}
    </resources>
    <library>
        <event name="${xmlEscape(options.title)}">
            <project name="${xmlEscape(options.title)}">
                <sequence format="${formatId}" duration="${totalDurationAttr}">
                    <spine>
${clipLines.join('\n')}
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
