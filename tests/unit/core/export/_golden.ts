/**
 * Shared test input for the Resolve golden tests (FCPXML + OTIO): the 7 ExportSegments of the M1 fixture
 * timeline. Never edit the golden files.
 */
import { readFileSync } from 'node:fs';
import type { ExportSegment, ExportOptions } from '../../../../src/types/export.js';
import { child, findAll, parseXml, rat, Rat, type XmlNode } from './_fcpxml-parse.js';

const GOLDEN_PATH = new URL('../../../fixtures/resolve-golden/m1-fixture.fcpxml', import.meta.url);
export const golden = readFileSync(GOLDEN_PATH, 'utf-8');

// ffprobe facts Resolve's FCPXML does not carry (STATUS.md, M1 fixture table).
export const FFPROBE_TC: Record<string, string> = {
  'C0289.MP4': '05:32:12:00',
  'GH010365.MP4': '13:58:58:20',
  'C0361.MP4': '05:54:26:44',
  'GH010376.MP4': '10:11:29:08',
  'C0562.MP4': '06:37:54:72',
  'C0382.MP4': '05:58:51:84',
};
// RULE: ExportSegment inputs that come from ingest (duration_sec, nb_frames, fps, TC, resolution) are
// hardcoded real ffprobe values, never derived from the golden — otherwise asset assertions are circular.
// Only source in/out and speed are derived from the golden's clip times.
// duration_sec = video-stream duration (what probe.ts stores); nb_frames = ffprobe count.
export const FFPROBE_MEDIA: Record<string, { duration_sec: number; nb_frames: number; resolution: string; fps?: number }> = {
  'C0289.MP4': { duration_sec: 12.96, nb_frames: 324, resolution: '3840x2160' },
  'GH010365.MP4': { duration_sec: 9.239989, nb_frames: 231, resolution: '3840x2160' },
  'C0361.MP4': { duration_sec: 7.2, nb_frames: 360, resolution: '3840x2160' },
  // GoPro VFR: avg rate 49.93; Resolve's 1415 frames @50 vs ffprobe nb_frames 1413.
  'GH010376.MP4': { duration_sec: 28.2999, nb_frames: 1413, resolution: '1920x1080', fps: 49.93 },
  'C0562.MP4': { duration_sec: 4.32, nb_frames: 432, resolution: '1920x1080' },
  'C0382.MP4': { duration_sec: 3.84, nb_frames: 384, resolution: '1920x1080' },
};

export interface Format { frameDuration: Rat; width: string; height: string }
export interface ResolvedClip {
  name: string;
  src: string;
  assetStart: Rat;
  assetDuration: Rat;
  assetFormat: Format;
  clipFormat: Format;
  tcFormat: string | undefined;
  offset: Rat;
  start: Rat;
  duration: Rat;
  timeMap: { frameSampling: string; pts: { value: Rat; time: Rat; interp: string }[] } | null;
  markers: { start: Rat; duration: Rat | null; value: string }[];
}
export interface Resolved {
  version: string;
  sequence: { tcStart: Rat; tcFormat: string; duration: Rat; format: Format };
  clips: ResolvedClip[];
}

export function resolve(xml: string): Resolved {
  const root = parseXml(xml);
  const formats = new Map<string, Format>();
  for (const f of findAll(root, 'format')) {
    formats.set(f.attrs.id, { frameDuration: rat(f.attrs.frameDuration), width: f.attrs.width, height: f.attrs.height });
  }
  const fmt = (id: string): Format => {
    const f = formats.get(id);
    if (!f) throw new Error(`unresolved format ${id}`);
    return f;
  };
  const assets = new Map<string, XmlNode>();
  for (const a of findAll(root, 'asset')) assets.set(a.attrs.id, a);

  const seq = findAll(root, 'sequence')[0];
  const clips = findAll(seq, 'asset-clip').map((c): ResolvedClip => {
    const asset = assets.get(c.attrs.ref);
    if (!asset) throw new Error(`unresolved asset ${c.attrs.ref}`);
    const tm = child(c, 'timeMap');
    return {
      name: c.attrs.name,
      src: child(asset, 'media-rep')!.attrs.src,
      assetStart: rat(asset.attrs.start),
      assetDuration: rat(asset.attrs.duration),
      assetFormat: fmt(asset.attrs.format),
      clipFormat: fmt(c.attrs.format),
      tcFormat: c.attrs.tcFormat,
      offset: rat(c.attrs.offset),
      start: rat(c.attrs.start),
      duration: rat(c.attrs.duration),
      timeMap: tm
        ? {
            frameSampling: tm.attrs.frameSampling,
            pts: tm.children.filter(t => t.tag === 'timept').map(t => ({
              value: rat(t.attrs.value), time: rat(t.attrs.time), interp: t.attrs.interp,
            })),
          }
        : null,
      markers: c.children.filter(m => m.tag === 'marker').map(m => ({
        start: rat(m.attrs.start),
        duration: m.attrs.duration ? rat(m.attrs.duration) : null,
        value: m.attrs.value,
      })),
    };
  });
  return {
    version: root.attrs.version,
    sequence: {
      tcStart: rat(seq.attrs.tcStart),
      tcFormat: seq.attrs.tcFormat,
      duration: rat(seq.attrs.duration),
      format: fmt(seq.attrs.format),
    },
    clips,
  };
}

/** Speed Resolve encoded in a timeMap: source span / timeline span, snapped to 3 decimals. */
export function goldenSpeed(c: ResolvedClip): number {
  if (!c.timeMap) return 1;
  const [a, b] = c.timeMap.pts;
  return Math.round(b.value.sub(a.value).div(b.time.sub(a.time)).toNumber() * 1000) / 1000;
}

export const g = resolve(golden);
export const fpsOf = (f: Format): number => 1 / f.frameDuration.toNumber();

/** The 7 ExportSegments equivalent to the golden timeline, derived from the golden itself. */
export function goldenSegments(): ExportSegment[] {
  return g.clips.map((c, i) => {
    const speed = goldenSpeed(c);
    const inPoint = c.start.sub(c.assetStart);
    const sourceDur = c.duration.mul(new Rat(BigInt(Math.round(speed * 1000)), 1000n));
    const media = FFPROBE_MEDIA[c.name];
    const fps = media.fps ?? fpsOf(c.assetFormat);
    return {
      position: i + 1,
      clip_id: i + 1,
      file_path: decodeURIComponent(c.src.replace(/^file:\/\//, '')),
      file_name: c.name,
      duration_sec: media.duration_sec,
      start_sec: inPoint.toNumber(),
      end_sec: inPoint.add(sourceDur).toNumber(),
      start_timecode: FFPROBE_TC[c.name],
      nb_frames: media.nb_frames,
      fps,
      has_video: true,
      has_audio: true,
      resolution: media.resolution,
      ai_summary: null,
      ai_quality_overall: null,
      segment_role: null,
      notes: null,
      speed,
    };
  });
}

export const OPTIONS: ExportOptions = {
  title: 'M1 Fixture',
  fps: fpsOf(g.sequence.format),
  width: Number(g.sequence.format.width),
  height: Number(g.sequence.format.height),
  format: 'fcpxml',
};

export const segments = goldenSegments();
