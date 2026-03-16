import { describe, it, expect } from 'vitest';
import { secondsToTimecode, timecodeToSeconds, formatDuration } from '../../../src/utils/timecode.js';

describe('secondsToTimecode', () => {
  it('converts 0 seconds', () => {
    expect(secondsToTimecode(0, 30)).toBe('00:00:00:00');
  });

  it('converts exact seconds at 30fps', () => {
    expect(secondsToTimecode(1, 30)).toBe('00:00:01:00');
    expect(secondsToTimecode(60, 30)).toBe('00:01:00:00');
    expect(secondsToTimecode(3600, 30)).toBe('01:00:00:00');
  });

  it('converts fractional seconds to frames at 30fps', () => {
    expect(secondsToTimecode(1.5, 30)).toBe('00:00:01:15');
  });

  it('converts at 24fps', () => {
    expect(secondsToTimecode(1, 24)).toBe('00:00:01:00');
    expect(secondsToTimecode(1.5, 24)).toBe('00:00:01:12');
  });

  it('converts at 25fps', () => {
    expect(secondsToTimecode(1.5, 25)).toBe('00:00:01:13');
  });

  it('handles large values', () => {
    expect(secondsToTimecode(7200, 30)).toBe('02:00:00:00');
  });
});

describe('timecodeToSeconds', () => {
  it('converts zero timecode', () => {
    expect(timecodeToSeconds('00:00:00:00', 30)).toBe(0);
  });

  it('converts whole seconds', () => {
    expect(timecodeToSeconds('00:00:01:00', 30)).toBe(1);
    expect(timecodeToSeconds('00:01:00:00', 30)).toBe(60);
    expect(timecodeToSeconds('01:00:00:00', 30)).toBe(3600);
  });

  it('converts with frames at 30fps', () => {
    expect(timecodeToSeconds('00:00:01:15', 30)).toBe(1.5);
  });

  it('throws on invalid format', () => {
    expect(() => timecodeToSeconds('00:00:00')).toThrow('Invalid timecode format');
  });

  it('roundtrips correctly', () => {
    const original = 125.7;
    const tc = secondsToTimecode(original, 30);
    const result = timecodeToSeconds(tc, 30);
    expect(Math.abs(result - original)).toBeLessThan(1 / 30);
  });
});

describe('formatDuration', () => {
  it('formats seconds only', () => {
    expect(formatDuration(45)).toBe('0:45');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(150)).toBe('2:30');
  });

  it('formats hours', () => {
    expect(formatDuration(3661)).toBe('1:01:01');
  });

  it('formats zero', () => {
    expect(formatDuration(0)).toBe('0:00');
  });
});
