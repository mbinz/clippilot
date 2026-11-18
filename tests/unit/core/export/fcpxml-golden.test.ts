/**
 * M1.1 — our FCPXML must be structurally equivalent to what DaVinci Resolve wrote
 * for the M1 fixture timeline (tests/fixtures/resolve-golden/m1-fixture.fcpxml,
 * FCPXML 1.13). The golden is truth: never edit it. All time values are compared
 * as exact rationals, never as raw strings; resource ids are compared by what
 * they resolve to, never by their spelling.
 */
import { describe, it, expect } from 'vitest';
import { exportFcpxml } from '../../../../src/core/export/fcpxml.js';
import { findAll, parseXml, rat } from './_fcpxml-parse.js';
import { golden, g, fpsOf, goldenSpeed, resolve, OPTIONS, segments } from './_golden.js';

const ours = resolve(exportFcpxml(segments, OPTIONS));

describe('golden sanity (test inputs derived from Resolve)', () => {
  it('golden is the 7-clip 1920x1080@24 timeline from FCPXML 1.13', () => {
    expect(g.version).toBe('1.13');
    expect(g.clips).toHaveLength(7);
    expect(fpsOf(g.sequence.format)).toBe(24);
    expect(segments.map(s => s.speed)).toEqual([1, 1, 0.5, 1, 0.25, 1, 1]);
  });
});

describe('exportFcpxml vs Resolve golden', () => {
  it('emits an FCPXML version that supports the elements Resolve uses (>= 1.10, media-rep)', () => {
    const [maj, min] = ours.version.split('.').map(Number);
    expect(maj * 100 + min).toBeGreaterThanOrEqual(110);
  });

  it('has the same number of spine clips', () => {
    expect(ours.clips).toHaveLength(g.clips.length);
  });

  it('sequence: own format, tcStart, tcFormat, duration', () => {
    expect(ours.sequence.format.frameDuration.eq(g.sequence.format.frameDuration)).toBe(true);
    expect(ours.sequence.format.width).toBe(g.sequence.format.width);
    expect(ours.sequence.format.height).toBe(g.sequence.format.height);
    expect(ours.sequence.tcStart.eq(g.sequence.tcStart)).toBe(true);
    expect(ours.sequence.tcFormat).toBe(g.sequence.tcFormat);
    expect(ours.sequence.duration.eq(g.sequence.duration)).toBe(true);
  });

  g.clips.forEach((gc, i) => {
    describe(`clip ${i + 1} ${gc.name} (speed ${goldenSpeed(gc)})`, () => {
      const oc = () => ours.clips[i];

      it('asset src URI matches (percent-encoding incl. trailing-space folder)', () => {
        expect(oc().src).toBe(gc.src);
      });

      it('asset start = source TC, duration = full media', () => {
        expect(oc().assetStart.toString(), 'asset start').toBe(gc.assetStart.toString());
        expect(oc().assetDuration.toString(), 'asset duration').toBe(gc.assetDuration.toString());
      });

      it('asset and clip reference the source format (frameDuration, width, height)', () => {
        for (const f of [oc().assetFormat, oc().clipFormat]) {
          expect(f.frameDuration.toString()).toBe(gc.assetFormat.frameDuration.toString());
          expect(f.width).toBe(gc.assetFormat.width);
          expect(f.height).toBe(gc.assetFormat.height);
        }
      });

      it('clip offset / start / duration match, tcFormat NDF', () => {
        expect(oc().offset.toString(), 'offset').toBe(gc.offset.toString());
        expect(oc().start.toString(), 'start').toBe(gc.start.toString());
        expect(oc().duration.toString(), 'duration').toBe(gc.duration.toString());
        expect(oc().tcFormat).toBe(gc.tcFormat);
      });

      it('retime: timeMap present iff Resolve wrote one, with the same speed', () => {
        if (!gc.timeMap) {
          expect(oc().timeMap).toBeNull();
          return;
        }
        const t = oc().timeMap!;
        expect(t, 'timeMap').not.toBeNull();
        expect(t.frameSampling).toBe(gc.timeMap.frameSampling);
        expect(t.pts).toHaveLength(2);
        expect(t.pts.every(p => p.interp === 'linear')).toBe(true);
        // first point sits on the asset start (source TC), value == time
        expect(t.pts[0].value.eq(gc.assetStart)).toBe(true);
        expect(t.pts[0].time.eq(gc.assetStart)).toBe(true);
        // slope matches Resolve's (relative error < 1e-6)
        const slope = (m: typeof t) => m.pts[1].time.sub(m.pts[0].time).div(m.pts[1].value.sub(m.pts[0].value)).toNumber();
        expect(Math.abs(slope(t) / slope(gc.timeMap) - 1)).toBeLessThan(1e-6);
        // spans the asset (Resolve stops ~1 source frame short of the full extent)
        const frame = gc.assetFormat.frameDuration.toNumber();
        const span = t.pts[1].value.sub(t.pts[0].value).toNumber();
        expect(Math.abs(span - gc.assetDuration.toNumber())).toBeLessThanOrEqual(1.1 * frame);
      });
    });
  });

  it('formats: one per distinct source format plus the sequence format (5 total, no duplicates)', () => {
    const xml = exportFcpxml(segments, OPTIONS);
    const formats = findAll(parseXml(xml), 'format');
    const keys = formats.map(f => `${rat(f.attrs.frameDuration)}|${f.attrs.width}x${f.attrs.height}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(formats).toHaveLength(findAll(parseXml(golden), 'format').length);
  });

  it('format names follow Resolve (FFVideoFormat1080p100, FFVideoFormat3840x2160p25, ...)', () => {
    const names = (x: string) => findAll(parseXml(x), 'format').map(f => f.attrs.name).sort();
    expect(names(exportFcpxml(segments, OPTIONS))).toEqual(names(golden));
  });

  it('one asset per timeline use (clip used twice -> two assets)', () => {
    const n = (x: string) => findAll(parseXml(x), 'asset').length;
    expect(n(exportFcpxml(segments, OPTIONS))).toBe(n(golden));
  });
});

describe('scene markers', () => {
  // Resolve's FCPXML carries no markers (golden has none), so this is our own contract:
  // a marker at the first segment of each scene, valued with the scene name.
  const base = segments.slice(0, 4).map((s, i) => ({
    ...s,
    scene_name: i < 2 ? '01 Ankunft' : '02 Farol Strand',
  }));
  const out = resolve(exportFcpxml(base, OPTIONS));

  it('golden carries no markers (documented Resolve behavior)', () => {
    expect(g.clips.every(c => c.markers.length === 0)).toBe(true);
  });

  it('puts one marker at the start of each scene, on its first clip', () => {
    expect(out.clips.map(c => c.markers.map(m => m.value))).toEqual([['01 Ankunft'], [], ['02 Farol Strand'], []]);
    // marker start is in source time: the clip's start
    expect(out.clips[0].markers[0].start.toString()).toBe(out.clips[0].start.toString());
    expect(out.clips[2].markers[0].start.toString()).toBe(out.clips[2].start.toString());
  });

  it('emits no markers when scene_name is absent', () => {
    expect(ours.clips.every(c => c.markers.length === 0)).toBe(true);
  });

  it('escapes XML in scene names', () => {
    const xml = exportFcpxml([{ ...segments[0], scene_name: 'Tom & "Jerry" <1>' }], OPTIONS);
    expect(resolve(xml).clips[0].markers[0].value).toBe('Tom & "Jerry" <1>');
  });
});

describe('exportFcpxml mixed rates', () => {
  it('does not throw on mixed source frame rates', () => {
    expect(() => exportFcpxml(segments, OPTIONS)).not.toThrow();
  });

  it('snaps VFR average rates (49.93 fps) onto the 50 fps grid', () => {
    const vfrSegs = segments.map((s, i) => (i === 3 ? { ...s, fps: 49.93 } : s));
    const vfr = resolve(exportFcpxml(vfrSegs, OPTIONS)).clips[3];
    expect(vfr.assetFormat.frameDuration.toString()).toBe('1/50');
    expect(vfr.assetDuration.toString()).toBe(rat('283/10s').toString());
  });

  it('asset extent for the VFR clip follows container duration, not nb_frames (1415 vs 1413)', () => {
    expect(ours.clips[3].assetDuration.toString()).toBe(rat('283/10s').toString());
  });
});
