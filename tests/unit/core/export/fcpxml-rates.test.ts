import { describe, it, expect } from 'vitest';
import {
  frameDurationFor,
  snapFps,
  timecodeToSourceFrames,
  tcFrameFieldRate,
} from '../../../../src/core/export/fcpxml-rates.js';

describe('timecodeToSourceFrames (golden values from Resolve m1-fixture.fcpxml)', () => {
  // asset start (seconds) x fps, read from the golden
  it('25p Sony: 05:32:12:00 -> 19932 s', () => {
    expect(timecodeToSourceFrames('05:32:12:00', 25)).toBe(19932 * 25);
  });
  it('25p GoPro: 13:58:58:20 -> 251694/5 s', () => {
    expect(timecodeToSourceFrames('13:58:58:20', 25)).toBe(Math.round((251694 / 5) * 25));
  });
  it('50p Sony: 05:54:26:44 -> 531672/25 s', () => {
    expect(timecodeToSourceFrames('05:54:26:44', 50)).toBe(Math.round((531672 / 25) * 50));
  });
  it('50p GoPro: 10:11:29:08 -> 917229/25 s', () => {
    expect(timecodeToSourceFrames('10:11:29:08', 50)).toBe(Math.round((917229 / 25) * 50));
  });
  it('Sony 100p quirk: 06:37:54:72 -> 596859/25 s (frame field / 200)', () => {
    expect(timecodeToSourceFrames('06:37:54:72', 100)).toBe(Math.round((596859 / 25) * 100));
  });
  it('Sony 100p quirk: 05:58:51:84 -> 1076571/50 s (frame field / 200)', () => {
    expect(timecodeToSourceFrames('05:58:51:84', 100)).toBe(Math.round((1076571 / 50) * 100));
  });
});

describe('tcFrameFieldRate (Sony high-fps hypothesis: 2 data points, both 100p)', () => {
  it('equals fps up to 50, twice fps above 50', () => {
    expect(tcFrameFieldRate(25)).toBe(25);
    expect(tcFrameFieldRate(50)).toBe(50);
    expect(tcFrameFieldRate(100)).toBe(200);
  });
});

describe('rates', () => {
  it('100 fps is in the rate table', () => {
    expect(frameDurationFor(100)).toEqual({ num: 100, den: 10000 });
  });
  it('snapFps maps ffprobe average rates onto canonical rates', () => {
    expect(snapFps(49.93)).toBe(50);
    expect(snapFps(24.98)).toBe(25);
    expect(snapFps(23.976023)).toBe(23.976);
    expect(snapFps(29.97)).toBe(29.97);
    expect(snapFps(100)).toBe(100);
  });
});
