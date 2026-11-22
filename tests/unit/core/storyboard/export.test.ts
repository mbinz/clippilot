import { describe, it, expect, beforeEach } from 'vitest';
import { setup } from './_helpers.js';
import { cutToSegments } from '../../../../src/core/storyboard/export.js';
import { exportSegments } from '../../../../src/core/export/index.js';

describe('cutToSegments', () => {
  let t: ReturnType<typeof setup>;
  let cutId: number;
  let a: number; // 60 fps clip
  let b: number; // 25 fps clip
  let ma: number[];
  let mb: number[];
  beforeEach(() => {
    t = setup();
    cutId = t.svc.createCut(t.projectId, 'Main').id;
    a = t.addClip({ fps: 60 }).id;
    b = t.addClip({ fps: 25 }).id;
    ma = t.addMoments(a, [{ start_sec: 2, end_sec: 6, suggested_speed: 0.5 }, { start_sec: 10, end_sec: 14 }]);
    mb = t.addMoments(b, [{ start_sec: 1, end_sec: 4 }]);
  });

  it('exports panels in scene/panel order with speed, scene name, and skips gaps', () => {
    const s1 = t.svc.addScene(cutId, 'Arrival');
    const s2 = t.svc.addScene(cutId, 'Beach');
    t.svc.addPanel(s1.id, { intent: 'gap one' });
    t.svc.addPanel(s1.id, { intent: 'wave', momentId: ma[0] });
    t.svc.addPanel(s1.id, { intent: 'sand', momentId: ma[1] });
    t.svc.addPanel(s2.id, { intent: 'town', momentId: mb[0] });

    const { segments, skipped_gaps } = cutToSegments(t.db, cutId);
    expect(skipped_gaps).toBe(1);
    expect(segments.map((s) => [s.position, s.clip_id, s.start_sec, s.end_sec, s.speed, s.scene_name])).toEqual([
      [1, a, 2, 6, 0.5, 'Arrival'],
      [2, a, 10, 14, 1, null],
      [3, b, 1, 4, 1, 'Beach'],
    ]);
    expect(segments[0]).toMatchObject({ file_path: '/v/c1.mp4', file_name: 'c1.mp4', fps: 60, segment_role: 'wave', has_audio: true });
  });

  it('a candidates panel exports its first candidate', () => {
    const s = t.svc.addScene(cutId, 'S');
    t.svc.addPanel(s.id, { intent: 'pick', candidates: [mb[0], ma[1]] });
    const { segments, skipped_gaps } = cutToSegments(t.db, cutId);
    expect(skipped_gaps).toBe(0);
    expect(segments.map((x) => [x.clip_id, x.start_sec, x.end_sec])).toEqual([[b, 1, 4]]);
  });

  it('a user trim and speed override the moment', () => {
    const s = t.svc.addScene(cutId, 'S');
    const p = t.svc.addPanel(s.id, { momentId: ma[0] });
    t.svc.trimPanel(p.id, 3, 5);
    t.svc.setSpeed(p.id, 1);
    expect(cutToSegments(t.db, cutId).segments[0]).toMatchObject({ start_sec: 3, end_sec: 5, speed: 1 });
  });

  it('OTIO of a 2-scene cut has 2 scene markers and a time warp only on the slowed panel', () => {
    const s1 = t.svc.addScene(cutId, 'Arrival');
    const s2 = t.svc.addScene(cutId, 'Beach');
    t.svc.addPanel(s1.id, { momentId: ma[0] });
    t.svc.addPanel(s1.id, { momentId: ma[1] });
    t.svc.addPanel(s2.id, { momentId: mb[0] });
    const { segments } = cutToSegments(t.db, cutId);
    const otio = exportSegments(segments, { title: 'T', fps: 60, format: 'otio' });
    expect((otio.match(/"OTIO_SCHEMA": "Marker\.2"/g) ?? []).length).toBe(2);
    // once on the video clip and once on its linked audio clip
    expect((otio.match(/LinearTimeWarp\.1/g) ?? []).length).toBe(2);
    expect(otio).toContain('"time_scalar": 0.5');
  });
});
