import { describe, it, expect } from 'vitest';
import {
  panelRange, panelLength, sceneLength, cutLength, speedOk, toChoose, usageOf,
  fmtClock, fmtSec, isOverTarget, firstSpeed,
} from '../../../web/src/board/logic.js';
import type { BoardPanel, BoardScene } from '../../../web/src/board/types.js';

const cand = (id: number, clip_id: number, start_sec: number, end_sec: number, suggested_speed = 1, speed = 1) =>
  ({ id, clip_id, start_sec, end_sec, description: 'd', tier: 'solid', suggested_speed, speed, thumbnail: null, proxy_url: null, clip: null });

const panel = (p: Partial<BoardPanel>): BoardPanel => ({
  id: 1, scene_id: 1, position: 0, intent: '', state: 'gap', source: 'ai', clip_id: null, moment_id: null,
  start_sec: null, end_sec: null, speed: 1, clip: null, moment: null, candidates: [], ...p,
});
const filled = (id: number, start: number, end: number, speed = 1, source: 'ai' | 'user' = 'ai', moment_id = id) =>
  panel({ id, state: 'filled', clip_id: 7, moment_id, start_sec: start, end_sec: end, speed, source });
const scene = (id: number, panels: BoardPanel[]): BoardScene =>
  ({ id, position: id, name: `S${id}`, event_id: null, event: null, panels });

describe('panel timeline length', () => {
  it('filled panel: range divided by speed', () => {
    expect(panelRange(filled(1, 2, 6, 0.5))).toEqual({ clipId: 7, a: 2, b: 6, speed: 0.5 });
    expect(panelLength(filled(1, 2, 6, 0.5))).toBe(8);
    expect(panelLength(filled(1, 2, 6, 1))).toBe(4);
  });

  it('candidates panel: the first candidate with its whole moment range and the moment speed', () => {
    const slow = panel({ state: 'candidates', candidates: [cand(5, 9, 10, 20, 0.5, 0.5), cand(6, 9, 20, 30)] });
    expect(panelRange(slow)).toEqual({ clipId: 9, a: 10, b: 20, speed: 0.5 });
    expect(panelLength(slow)).toBe(20);
    const normal = panel({ state: 'candidates', candidates: [cand(5, 9, 10, 12.5)] });
    expect(panelRange(normal)).toEqual({ clipId: 9, a: 10, b: 12.5, speed: 1 });
  });

  it('gap and empty candidates have no range and zero length', () => {
    expect(panelRange(panel({}))).toBeNull();
    expect(panelLength(panel({}))).toBe(0);
    expect(panelLength(panel({ state: 'candidates' }))).toBe(0);
  });
});

describe('totals', () => {
  const s1 = scene(1, [filled(1, 0, 4), panel({ id: 2, state: 'candidates', candidates: [cand(9, 3, 0, 3)] }), panel({ id: 3 })]);
  const s2 = scene(2, [filled(4, 0, 2, 0.5)]);
  it('scene and cut lengths sum panel lengths', () => {
    expect(sceneLength(s1)).toBe(7);
    expect(sceneLength(s2)).toBe(4);
    expect(cutLength([s1, s2])).toBe(11);
  });
  it('isOverTarget is true only above 110 % of the target', () => {
    expect(isOverTarget(110, 100)).toBe(false);
    expect(isOverTarget(110.5, 100)).toBe(true);
    expect(isOverTarget(50, 0)).toBe(false);
  });
});

describe('speed gating', () => {
  it('100 % always; 50 % from 48 fps; 25 % from 90 fps', () => {
    expect(speedOk(25, 1)).toBe(true);
    expect(speedOk(null, 1)).toBe(true);
    expect(speedOk(25, 0.5)).toBe(false);
    expect(speedOk(50, 0.5)).toBe(true);
    expect(speedOk(50, 0.25)).toBe(false);
    expect(speedOk(120, 0.25)).toBe(true);
    expect(speedOk(null, 0.5)).toBe(false);
    expect(speedOk(120, 0.3)).toBe(false);
  });
  it('firstSpeed falls back to 1 when the suggestion is not allowed', () => {
    expect(firstSpeed(0.5, 25)).toBe(1);
    expect(firstSpeed(0.5, 60)).toBe(0.5);
  });
});

describe('to choose list', () => {
  it('lists candidate panels in cut order with scene index and panel number', () => {
    const a = scene(1, [filled(1, 0, 1), panel({ id: 2, state: 'candidates', candidates: [cand(1, 1, 0, 1)] })]);
    const b = scene(2, [panel({ id: 3, state: 'candidates', candidates: [cand(2, 1, 0, 1)] }), filled(4, 0, 1)]);
    expect(toChoose([a, b])).toEqual([
      { sceneIndex: 0, sceneId: 1, panelId: 2, panelNo: 2 },
      { sceneIndex: 1, sceneId: 2, panelId: 3, panelNo: 1 },
    ]);
    expect(toChoose([scene(1, [filled(1, 0, 1)])])).toEqual([]);
  });
});

describe('usage', () => {
  it('maps filled moments to mine (user) or ai', () => {
    const scenes = [scene(1, [filled(1, 0, 1, 1, 'user', 11), filled(2, 0, 1, 1, 'ai', 12), panel({ id: 3 })])];
    expect(usageOf(scenes)).toEqual({ 11: 'mine', 12: 'ai' });
  });
});

describe('formatting', () => {
  it('fmtClock m:ss and fmtSec one decimal', () => {
    expect(fmtClock(165)).toBe('2:45');
    expect(fmtClock(5.4)).toBe('0:05');
    expect(fmtSec(3.14159)).toBe('3.1 s');
  });
});
