/**
 * M1.2 — our OTIO must be structurally equivalent to what DaVinci Resolve wrote for the M1 fixture
 * (tests/fixtures/resolve-golden/m1-fixture.otio). The golden is truth: never edit it.
 * Ingest facts (duration, nb_frames, fps, TC, resolution) are hardcoded ffprobe values from _golden.ts;
 * source in/out and speed come from the golden timeline, scene names from the golden's video-clip markers.
 * Resolve's `Resolve_OTIO` metadata and unnamed "Resolve Effect" entries are deliberately not compared.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { exportOtio } from '../../../../src/core/export/otio.js';
import { OPTIONS, segments as baseSegments } from './_golden.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const golden: any = JSON.parse(
  readFileSync(new URL('../../../fixtures/resolve-golden/m1-fixture.otio', import.meta.url), 'utf-8'),
);

const track = (tl: any, kind: string): any => tl.tracks.children.find((t: any) => t.kind === kind);

// Scene of each clip = most recent video-clip marker at or before it (Resolve puts one marker on each scene's first clip).
const sceneNames: string[] = [];
{
  let current = '';
  for (const c of track(golden, 'Video').children) {
    if (c.markers.length > 0) current = c.markers[0].name;
    sceneNames.push(current);
  }
}
const segments = baseSegments.map((s, i) => ({ ...s, scene_name: sceneNames[i] }));
const ours: any = JSON.parse(exportOtio(segments, OPTIONS));

const warp = (clip: any): any => clip.effects.find((e: any) => e.OTIO_SCHEMA.startsWith('LinearTimeWarp'));
const TL = 24;

describe('golden sanity', () => {
  it('is a 24 fps timeline of 7 clips on a Video and an Audio track, 3 scenes', () => {
    expect(golden.global_start_time.rate).toBe(24);
    expect(track(golden, 'Video').children).toHaveLength(7);
    expect(track(golden, 'Audio').children).toHaveLength(7);
    expect([...new Set(sceneNames)]).toHaveLength(3);
  });
});

describe('exportOtio vs Resolve golden', () => {
  it('timeline schema and global_start_time (01:00:00:00 @ 24)', () => {
    expect(ours.OTIO_SCHEMA).toBe(golden.OTIO_SCHEMA);
    expect(ours.tracks.OTIO_SCHEMA).toBe(golden.tracks.OTIO_SCHEMA);
    expect(ours.global_start_time).toEqual(golden.global_start_time);
  });

  it('has the same tracks, kinds, names and clip counts', () => {
    expect(ours.tracks.children.map((t: any) => [t.OTIO_SCHEMA, t.kind, t.name, t.children.length])).toEqual(
      golden.tracks.children.map((t: any) => [t.OTIO_SCHEMA, t.kind, t.name, t.children.length]),
    );
  });

  for (const kind of ['Video', 'Audio']) {
    describe(`${kind} track`, () => {
      track(golden, kind).children.forEach((gc: any, i: number) => {
        describe(`clip ${i + 1} ${gc.name}`, () => {
          const oc = () => track(ours, kind).children[i];
          const gref = gc.media_references.DEFAULT_MEDIA;
          const oref = () => oc().media_references.DEFAULT_MEDIA;

          it('is a Clip.2 with the same name and an ExternalReference', () => {
            expect(oc().OTIO_SCHEMA).toBe('Clip.2');
            expect(oc().name).toBe(gc.name);
            expect(oc().active_media_reference_key).toBe(gc.active_media_reference_key);
            expect(oref().OTIO_SCHEMA).toBe('ExternalReference.1');
          });

          it('target_url is a plain absolute path (unencoded, trailing-space folder intact)', () => {
            expect(oref().target_url).toBe(gref.target_url);
          });

          it('available_range: source rate, source TC start, full-media duration', () => {
            const a = oref().available_range;
            const b = gref.available_range;
            expect(a.start_time.rate).toBe(b.start_time.rate);
            expect(a.duration.rate).toBe(b.duration.rate);
            expect(a.start_time.value).toBeCloseTo(b.start_time.value, 6);
            expect(a.duration.value).toBeCloseTo(b.duration.value, 6);
          });

          it('source_range: timeline rate, same duration, start within 1 timeline frame', () => {
            const a = oc().source_range;
            const b = gc.source_range;
            expect(a.duration).toEqual(b.duration);
            expect(a.start_time.rate).toBe(TL);
            expect(Math.abs(a.start_time.value - b.start_time.value)).toBeLessThanOrEqual(1);
          });

          it('retime: LinearTimeWarp with the same time_scalar iff Resolve wrote one', () => {
            const g = warp(gc);
            const o = warp(oc());
            if (!g) {
              expect(o).toBeUndefined();
              return;
            }
            expect(o).toBeDefined();
            expect(Math.abs(o.time_scalar / g.time_scalar - 1)).toBeLessThan(1e-9);
          });
        });
      });
    });
  }

  it('scene markers: video track only, first clip of each scene, same name, 1 frame, start within 1 frame', () => {
    const gv = track(golden, 'Video').children;
    const ov = track(ours, 'Video').children;
    expect(ov.map((c: any) => c.markers.map((m: any) => m.name))).toEqual(
      gv.map((c: any) => c.markers.map((m: any) => m.name)),
    );
    gv.forEach((gc: any, i: number) => {
      gc.markers.forEach((gm: any, j: number) => {
        const om = ov[i].markers[j];
        expect(om.OTIO_SCHEMA).toBe('Marker.2');
        expect(om.marked_range.duration).toEqual(gm.marked_range.duration);
        expect(Math.abs(om.marked_range.start_time.value - gm.marked_range.start_time.value)).toBeLessThanOrEqual(1);
      });
    });
  });

  it('puts no scene markers on the audio track', () => {
    expect(track(ours, 'Audio').children.every((c: any) => c.markers.length === 0)).toBe(true);
  });

  it('emits no markers when scene_name is absent', () => {
    const plain: any = JSON.parse(exportOtio(baseSegments, OPTIONS));
    expect(plain.tracks.children.every((t: any) => t.children.every((c: any) => c.markers.length === 0))).toBe(true);
  });
});
