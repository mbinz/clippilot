import { describe, it, expect } from 'vitest';
import { defaultRange, PANEL_DEFAULT_SEC } from '../../../../src/core/storyboard/range.js';

describe('defaultRange', () => {
  it('centres a 4 s window on a long moment', () => {
    expect(defaultRange({ start_sec: 10, end_sec: 31, suggested_speed: 1 }, { fps: 25 }))
      .toEqual({ start_sec: 18.5, end_sec: 22.5, speed: 1 });
    expect(PANEL_DEFAULT_SEC).toBe(4);
  });
  it('slow-mo on 50 fps keeps 2 s of source at 0.5', () => {
    expect(defaultRange({ start_sec: 0, end_sec: 10, suggested_speed: 0.5 }, { fps: 50 }))
      .toEqual({ start_sec: 4, end_sec: 6, speed: 0.5 });
  });
  it('falls back to speed 1 and 4 s when the fps is too low', () => {
    expect(defaultRange({ start_sec: 0, end_sec: 10, suggested_speed: 0.5 }, { fps: 25 }))
      .toEqual({ start_sec: 3, end_sec: 7, speed: 1 });
  });
  it('uses a short moment whole', () => {
    expect(defaultRange({ start_sec: 2, end_sec: 4.5, suggested_speed: 1 }, { fps: 25 }))
      .toEqual({ start_sec: 2, end_sec: 4.5, speed: 1 });
  });
});
