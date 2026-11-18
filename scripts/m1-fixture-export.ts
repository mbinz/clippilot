/**
 * M1 spike — delete after M1.3.
 * Builds the 7-segment "M1 Fixture" reference timeline (STATUS.md, M1 table) from the ingested fixture DB
 * and writes ClipPilot M1.fcpxml + ClipPilot M1.otio next to it (1920x1080 @ 24).
 *
 *   npx tsx scripts/m1-fixture-export.ts
 */
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDb } from '../src/db/connection.js';
import { ClipRepository } from '../src/db/repositories/clip.repository.js';
import { exportSegments } from '../src/core/export/index.js';
import type { ExportSegment } from '../src/types/export.js';

const root = path.join(os.homedir(), 'Video', 'ClipPilot M1 Fixture');
const db = createDb(path.join(root, '.clippilot', 'clippilot.db'));
const repo = new ClipRepository(db);

// [file, in s, out s (null = whole clip), speed, scene]
const TIMELINE: [string, number, number | null, number, string][] = [
  ['C0289.MP4', 2, 6, 1, '01 Ankunft'],
  ['GH010365.MP4', 1, 5, 1, '01 Ankunft'],
  ['C0361.MP4', 1, 4, 0.5, '02 Farol Strand'],
  ['GH010376.MP4', 5, 9, 1, '02 Farol Strand'],
  ['C0562.MP4', 0.5, 3.5, 0.25, '03 Delfine'],
  ['C0562.MP4', 0.5, 3.5, 1, '03 Delfine'],
  ['C0382.MP4', 0, null, 1, '03 Delfine'],
];

const all = repo.findByIds(Array.from({ length: 50 }, (_, i) => i + 1));
const segments: ExportSegment[] = TIMELINE.map(([file, inSec, outSec, speed, scene], i) => {
  const clip = all.find(c => path.basename(c.file_path) === file);
  if (!clip) throw new Error(`${file} not found in fixture DB`);
  return {
    position: i + 1,
    clip_id: clip.id,
    file_path: clip.file_path,
    file_name: file,
    duration_sec: clip.duration_sec,
    start_sec: inSec,
    end_sec: outSec ?? clip.duration_sec,
    start_timecode: clip.start_timecode ?? null,
    nb_frames: clip.nb_frames ?? null,
    fps: clip.fps ?? 0,
    has_video: clip.has_video !== 0,
    has_audio: clip.has_audio !== 0,
    resolution: clip.resolution,
    ai_summary: null,
    ai_quality_overall: null,
    segment_role: null,
    notes: null,
    speed,
    scene_name: scene,
  };
});

const options = { title: 'ClipPilot M1', fps: 24, width: 1920, height: 1080 };
for (const [format, ext] of [['fcpxml', 'fcpxml'], ['otio', 'otio']] as const) {
  const out = path.join(root, `ClipPilot M1.${ext}`);
  writeFileSync(out, exportSegments(segments, { ...options, format }), 'utf-8');
  console.log(out);
}
db.close();
