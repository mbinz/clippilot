import type { ExportSegment, ExportOptions } from '../../types/export.js';
import { pathToFileUri } from '../../utils/fs.js';
import {
  formatName,
  frameDurationFor,
  snapFps,
  timeAttr,
  timecodeToSourceFrames,
} from './fcpxml-rates.js';

// 1.10 is the oldest FCPXML version with <media-rep>, which we emit. Resolve itself writes 1.13.
const FCPXML_VERSION = '1.10';
// Resolve's default timeline start timecode (01:00:00:00).
const TIMELINE_START_SECONDS = 3600;
const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;

interface FormatEntry {
  id: string;
  width: number;
  height: number;
  fps: number;
}

export function exportFcpxml(segments: ExportSegment[], options: ExportOptions): string {
  if (segments.length === 0) {
    throw new Error('Cannot export an empty segment list.');
  }

  const timelineFps = snapFps(options.fps);
  const tl = frameDurationFor(timelineFps);
  const timelineWidth = options.width ?? DEFAULT_WIDTH;
  const timelineHeight = options.height ?? DEFAULT_HEIGHT;

  // One <format> per distinct (width, height, fps); the sequence's own format is r0.
  let nextId = 0;
  const formats = new Map<string, FormatEntry>();
  const formatFor = (width: number, height: number, fps: number): FormatEntry => {
    const key = `${width}x${height}@${fps}`;
    let f = formats.get(key);
    if (!f) {
      f = { id: `r${nextId++}`, width, height, fps };
      formats.set(key, f);
    }
    return f;
  };
  const sequenceFormat = formatFor(timelineWidth, timelineHeight, timelineFps);

  const assetLines: string[] = [];
  const clipLines: string[] = [];
  let timelineFrames = 0;
  let previousScene: string | null = null;

  for (const seg of segments) {
    const clipFps = snapFps(seg.fps > 0 ? seg.fps : timelineFps);
    const cd = frameDurationFor(clipFps);
    const [width, height] = parseResolution(seg.resolution) ?? [timelineWidth, timelineHeight];
    const format = formatFor(width, height, clipFps);
    const assetId = `r${nextId++}`;
    const speed = seg.speed != null && seg.speed > 0 ? seg.speed : 1;

    // Source TC at the clip's own rate, integer frames.
    const tcBaseFrames = seg.start_timecode ? timecodeToSourceFrames(seg.start_timecode, clipFps) : 0;
    // Asset extent: container duration (what Resolve uses; nb_frames undercounts on VFR footage).
    const assetFrames = seg.duration_sec > 0
      ? Math.round(seg.duration_sec * clipFps)
      : (seg.nb_frames ?? 0);

    const startFrames = Math.round(seg.start_sec * clipFps);
    // Timeline length on the timeline grid; source seconds / speed.
    let clipTimelineFrames = Math.round(((seg.end_sec - seg.start_sec) / speed) * timelineFps);
    // Stay in-bounds: never run past the end of the media (Resolve's own whole-clip export does not trim a frame).
    const availableSourceSec = (assetFrames - startFrames) / clipFps;
    const maxTimelineFrames = Math.floor((availableSourceSec / speed) * timelineFps + 1e-9);
    if (assetFrames > 0 && clipTimelineFrames > maxTimelineFrames) clipTimelineFrames = maxTimelineFrames;
    if (clipTimelineFrames < 1) clipTimelineFrames = 1;

    const uri = xmlEscape(pathToFileUri(seg.file_path));
    assetLines.push(
      `        <asset id="${assetId}" name="${xmlEscape(seg.file_name)}" ` +
      `start="${tcBaseFrames > 0 ? timeAttr(tcBaseFrames, clipFps) : '0s'}" ` +
      `duration="${timeAttr(assetFrames, clipFps)}" format="${format.id}" ` +
      `hasVideo="${seg.has_video ? '1' : '0'}" hasAudio="${seg.has_audio ? '1' : '0'}">` +
      `\n            <media-rep kind="original-media" src="${uri}"/>` +
      `\n        </asset>`,
    );

    const startAttr = timeAttr(tcBaseFrames + startFrames, clipFps);
    const offsetAttr = `${TIMELINE_START_SECONDS * tl.den + timelineFrames * tl.num}/${tl.den}s`;
    const children: string[] = [];

    if (speed !== 1) {
      const [p, q] = toRational(speed); // speed = p/q
      const spanFrames = Math.max(assetFrames - 1, 1);
      const valueStartNum = tcBaseFrames * cd.num; // over cd.den
      const valueEnd = frac(valueStartNum + spanFrames * cd.num, cd.den);
      // time = valueStart + span / speed
      const timeEnd = frac(valueStartNum * p + spanFrames * cd.num * q, cd.den * p);
      const valueStart = frac(valueStartNum, cd.den);
      children.push(
        `                            <timeMap frameSampling="floor">` +
        `\n                                <timept value="${valueStart}" time="${valueStart}" interp="linear"/>` +
        `\n                                <timept value="${valueEnd}" time="${timeEnd}" interp="linear"/>` +
        `\n                            </timeMap>`,
      );
    }

    const scene = seg.scene_name ? seg.scene_name : null;
    if (scene && scene !== previousScene) {
      children.push(
        `                            <marker start="${startAttr}" duration="${timeAttr(1, clipFps)}" ` +
        `value="${xmlEscape(scene)}"/>`,
      );
    }
    if (scene) previousScene = scene;

    const head =
      `                        <asset-clip name="${xmlEscape(seg.file_name)}" ref="${assetId}" ` +
      `offset="${offsetAttr}" start="${startAttr}" duration="${timeAttr(clipTimelineFrames, timelineFps)}" ` +
      `format="${format.id}" tcFormat="NDF"`;
    clipLines.push(
      children.length === 0
        ? `${head}/>`
        : `${head}>\n${children.join('\n')}\n                        </asset-clip>`,
    );

    timelineFrames += clipTimelineFrames;
  }

  const formatLines = [...formats.values()].map(
    f =>
      `        <format id="${f.id}" name="${formatName(f.width, f.height, f.fps)}" ` +
      `frameDuration="${frameDurationAttr(f.fps)}" width="${f.width}" height="${f.height}"/>`,
  );

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="${FCPXML_VERSION}">
    <resources>
${formatLines.join('\n')}
${assetLines.join('\n')}
    </resources>
    <library>
        <event name="${xmlEscape(options.title)}">
            <project name="${xmlEscape(options.title)}">
                <sequence format="${sequenceFormat.id}" duration="${timeAttr(timelineFrames, timelineFps)}" ` +
    `tcStart="${TIMELINE_START_SECONDS}/1s" tcFormat="NDF">
                    <spine>
${clipLines.join('\n')}
                    </spine>
                </sequence>
            </project>
        </event>
    </library>
</fcpxml>`;
}

function frameDurationAttr(fps: number): string {
  const { num, den } = frameDurationFor(fps);
  return `${num}/${den}s`;
}

function parseResolution(resolution: string | null): [number, number] | null {
  const m = resolution?.match(/^(\d+)\s*x\s*(\d+)$/i);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

function frac(num: number, den: number): string {
  return num === 0 ? '0s' : `${num}/${den}s`;
}

/** Small exact rational for a speed factor (0.5 -> [1, 2], 0.25 -> [1, 4]). */
function toRational(x: number): [number, number] {
  for (let q = 1; q <= 1000; q++) {
    const p = Math.round(x * q);
    if (p > 0 && Math.abs(p / q - x) < 1e-9) return [p, q];
  }
  return [Math.round(x * 1_000_000), 1_000_000];
}

function xmlEscape(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
