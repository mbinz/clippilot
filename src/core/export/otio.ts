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
 * Resolve-specific metadata (ignored by other OTIO consumers). Without the shared `Link Group ID`
 * Resolve imports video and audio clips unlinked (M1.3). Values mirror the golden export.
 * Audio is assumed stereo (2 channels on source track 0): the channel count isn't stored yet.
 */
function resolveMetadata(
  scope: 'timeline' | 'videoTrack' | 'audioTrack' | 'videoClip' | 'audioClip',
  linkGroupId = 0,
): Record<string, unknown> {
  switch (scope) {
    case 'timeline':
      return { Resolve_OTIO: { 'Resolve OTIO Meta Version': '1.0' } };
    case 'videoTrack':
      return { Resolve_OTIO: { Locked: false } };
    case 'audioTrack':
      return { Resolve_OTIO: { 'Audio Type': 'Stereo', Locked: false, SoloOn: false } };
    case 'videoClip':
      return { Resolve_OTIO: { 'Link Group ID': linkGroupId } };
    case 'audioClip':
      return {
        Resolve_OTIO: {
          Channels: [
            { 'Source Channel ID': 0, 'Source Track ID': 0 },
            { 'Source Channel ID': 1, 'Source Track ID': 0 },
          ],
          'Link Group ID': linkGroupId,
        },
      };
  }
}

/**
 * OTIO timeline mirroring DaVinci Resolve's export (tests/fixtures/resolve-golden/m1-fixture.otio):
 * a Video and an Audio track, each clip on both; source_range on the timeline grid in absolute source TC;
 * media references with plain-path target_url; speed as LinearTimeWarp; scene markers on the video clips.
 * Resolve's unnamed "Resolve Effect" entries are not emitted; `Resolve_OTIO` metadata is (see resolveMetadata).
 */
export function exportOtio(segments: ExportSegment[], options: ExportOptions): string {
  if (segments.length === 0) {
    throw new Error('Cannot export an empty segment list.');
  }
  const timelineFps = snapFps(options.fps);
  const tlRate = rateOf(timelineFps);
  const plans = planSegments(segments, timelineFps);

  const clip = (p: PlannedSegment, index: number, kind: 'Video' | 'Audio') => {
    const withMarkers = kind === 'Video';
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
      metadata: resolveMetadata(kind === 'Video' ? 'videoClip' : 'audioClip', index + 1),
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

  const track = (kind: 'Video' | 'Audio') => ({
    OTIO_SCHEMA: 'Track.1',
    metadata: resolveMetadata(kind === 'Video' ? 'videoTrack' : 'audioTrack'),
    name: `${kind} 1`,
    source_range: null,
    effects: [],
    markers: [],
    enabled: true,
    children: plans.map((p, i) => clip(p, i, kind)),
    kind,
  });

  return JSON.stringify(
    {
      OTIO_SCHEMA: 'Timeline.1',
      metadata: resolveMetadata('timeline'),
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
        children: [track('Video'), track('Audio')],
      },
    },
    null,
    2,
  );
}
