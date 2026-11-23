import { describe, it, expect } from 'vitest';
import { defaultSpeed } from '../../../../src/core/storyboard/range.js';

describe('defaultSpeed', () => {
  it('is the suggested speed when the clip frame rate allows it', () => {
    expect(defaultSpeed(0.5, 50)).toBe(0.5);
    expect(defaultSpeed(0.25, 120)).toBe(0.25);
  });
  it('falls back to 1 when fps is too low or unknown', () => {
    expect(defaultSpeed(0.5, 25)).toBe(1);
    expect(defaultSpeed(0.25, 50)).toBe(1);
    expect(defaultSpeed(0.5, null)).toBe(1);
  });
  it('1 stays 1', () => {
    expect(defaultSpeed(1, 25)).toBe(1);
  });
});
