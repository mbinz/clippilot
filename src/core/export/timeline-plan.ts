import type { ExportSegment } from '../../types/export.js';
import { snapFps, timecodeToSourceFrames } from './fcpxml-rates.js';

/** Resolve's default timeline start timecode (01:00:00:00). */
export const TIMELINE_START_SECONDS = 3600;

/** Everything the FCPXML and OTIO exporters need to know about one segment, in integer frames. */
export interface PlannedSegment {
  seg: ExportSegment;
  /** Source rate, snapped (49.93 -> 50). */
  clipFps: number;
  /** Source TC of the first frame of the media, in source frames. */
  tcBaseFrames: number;
  /** Full media extent in source frames. */
  assetFrames: number;
  /** In-point in source frames, relative to the start of the media. */
  startFrames: number;
  speed: number;
  /** Length on the timeline grid. */
  timelineFrames: number;
  /** Timeline frames before this segment. */
  offsetFrames: number;
  /** Scene name when this is the first segment of a new scene, else null. */
  sceneStart: string | null;
}

export function planSegments(segments: ExportSegment[], timelineFps: number): PlannedSegment[] {
  const plans: PlannedSegment[] = [];
  let offsetFrames = 0;
  let previousScene: string | null = null;

  for (const seg of segments) {
    const clipFps = snapFps(seg.fps > 0 ? seg.fps : timelineFps);
    const speed = seg.speed != null && seg.speed > 0 ? seg.speed : 1;
    const tcBaseFrames = seg.start_timecode ? timecodeToSourceFrames(seg.start_timecode, clipFps) : 0;
    // Asset extent: video-stream duration (what Resolve uses); nb_frames only as a fallback.
    const assetFrames = seg.duration_sec > 0
      ? Math.round(seg.duration_sec * clipFps)
      : (seg.nb_frames ?? 0);
    const startFrames = Math.round(seg.start_sec * clipFps);

    let timelineFrames = Math.round(((seg.end_sec - seg.start_sec) / speed) * timelineFps);
    // Stay in-bounds: never run past the end of the media (Resolve's own whole-clip export does not trim a frame).
    const availableSourceSec = (assetFrames - startFrames) / clipFps;
    const maxTimelineFrames = Math.floor((availableSourceSec / speed) * timelineFps + 1e-9);
    if (assetFrames > 0 && timelineFrames > maxTimelineFrames) timelineFrames = maxTimelineFrames;
    if (timelineFrames < 1) timelineFrames = 1;

    const scene = seg.scene_name ? seg.scene_name : null;
    const sceneStart = scene && scene !== previousScene ? scene : null;
    if (scene) previousScene = scene;

    plans.push({ seg, clipFps, tcBaseFrames, assetFrames, startFrames, speed, timelineFrames, offsetFrames, sceneStart });
    offsetFrames += timelineFrames;
  }
  return plans;
}
