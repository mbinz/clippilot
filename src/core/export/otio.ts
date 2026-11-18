import type { ExportSegment, ExportOptions } from '../../types/export.js';
import { frameDurationFor, snapFps } from './fcpxml-rates.js';
import { TIMELINE_START_SECONDS, planSegments, type PlannedSegment } from './timeline-plan.js';

/** OTIO RationalTime rate for a (snapped) fps: 24 -> 24, 23.976 -> 24000/1001. */
function rateOf(fps: number): number {
  const { num, den } = frameDurationFor(fps);
  return den / num;
}

const time = (value: number, rate: number) => ({ OTIO_SCHEMA: 'RationalTime.1', rate, value });
const range = (start: number, duration: number, rate: number) => ({
  OTIO_SCHEMA: 'TimeRange.1',
  duration: time(duration, rate),
  start_time: time(start, rate),
});

/**
 * OTIO timeline mirroring DaVinci Resolve's export (tests/fixtures/resolve-golden/m1-fixture.otio):
 * a Video and an Audio track, each clip on both; source_range on the timeline grid in absolute source TC;
 * media references with plain-path target_url; speed as LinearTimeWarp; scene markers on the video clips.
 * Resolve's `Resolve_OTIO` metadata and its unnamed "Resolve Effect" entries are not emitted.
 */
export function exportOtio(segments: ExportSegment[], options: ExportOptions): string {
  if (segments.length === 0) {
    throw new Error('Cannot export an empty segment list.');
  }
  const timelineFps = snapFps(options.fps);
  const tlRate = rateOf(timelineFps);
  const plans = planSegments(segments, timelineFps);

  const clip = (p: PlannedSegment, withMarkers: boolean) => {
    const clipRate = rateOf(p.clipFps);
    // Source TC of the media start on the timeline grid; the in-point is truncated to a timeline frame.
    const mediaStart = (p.tcBaseFrames / clipRate) * tlRate;
    const inFrames = Math.floor(p.seg.start_sec * tlRate + 1e-6);
    const effects = p.speed !== 1
      ? [{ OTIO_SCHEMA: 'LinearTimeWarp.1', metadata: {}, name: '', effect_name: '', time_scalar: p.speed }]
      : [];
    const markers = withMarkers && p.sceneStart
      ? [{
          OTIO_SCHEMA: 'Marker.2',
          metadata: {},
          name: p.sceneStart,
          color: 'BLUE',
          marked_range: range(mediaStart + inFrames, 1, tlRate),
        }]
      : [];
    return {
      OTIO_SCHEMA: 'Clip.2',
      metadata: {},
      name: p.seg.file_name,
      source_range: range(mediaStart + inFrames * p.speed, p.timelineFrames, tlRate),
      effects,
      markers,
      enabled: true,
      media_references: {
        DEFAULT_MEDIA: {
          OTIO_SCHEMA: 'ExternalReference.1',
          metadata: {},
          name: p.seg.file_name,
          available_range: range(p.tcBaseFrames, p.assetFrames, clipRate),
          available_image_bounds: null,
          target_url: p.seg.file_path,
        },
      },
      active_media_reference_key: 'DEFAULT_MEDIA',
    };
  };

  const track = (kind: 'Video' | 'Audio', withMarkers: boolean) => ({
    OTIO_SCHEMA: 'Track.1',
    metadata: {},
    name: `${kind} 1`,
    source_range: null,
    effects: [],
    markers: [],
    enabled: true,
    children: plans.map(p => clip(p, withMarkers)),
    kind,
  });

  return JSON.stringify(
    {
      OTIO_SCHEMA: 'Timeline.1',
      metadata: {},
      name: options.title,
      global_start_time: time(TIMELINE_START_SECONDS * tlRate, tlRate),
      tracks: {
        OTIO_SCHEMA: 'Stack.1',
        metadata: {},
        name: '',
        source_range: null,
        effects: [],
        markers: [],
        enabled: true,
        children: [track('Video', true), track('Audio', false)],
      },
    },
    null,
    2,
  );
}
