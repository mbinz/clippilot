import { describe, it, expect } from 'vitest';
import { freeStretch, clampSelection } from '../../../web/src/board/newmoment.js';

const ms = [{ start_sec: 2, end_sec: 6 }, { start_sec: 10, end_sec: 14 }];

describe('freeStretch (the footage around t that no moment covers)', () => {
  it('between two moments', () => { expect(freeStretch(ms, 8, 30)).toEqual({ a: 6, b: 10 }); });
  it('before the first moment starts at 0', () => { expect(freeStretch(ms, 1, 30)).toEqual({ a: 0, b: 2 }); });
  it('after the last moment ends at the clip end', () => { expect(freeStretch(ms, 20, 30)).toEqual({ a: 14, b: 30 }); });
  it('a clip without moments is free from end to end', () => { expect(freeStretch([], 5, 30)).toEqual({ a: 0, b: 30 }); });
  it('inside a moment there is none', () => {
    expect(freeStretch(ms, 4, 30)).toBeNull();
    expect(freeStretch(ms, 2.01, 30)).toBeNull();
  });
  it('exactly on an edge counts as free on the outer side', () => {
    expect(freeStretch(ms, 6, 30)).toEqual({ a: 6, b: 10 });
    expect(freeStretch(ms, 2, 30)).toEqual({ a: 0, b: 2 });
  });
  it('overlapping and unordered moments are handled', () => {
    expect(freeStretch([{ start_sec: 10, end_sec: 14 }, { start_sec: 2, end_sec: 12 }], 20, 30)).toEqual({ a: 14, b: 30 });
  });
  it('touching moments leave no free stretch between them', () => {
    expect(freeStretch([{ start_sec: 2, end_sec: 6 }, { start_sec: 6, end_sec: 9 }], 6, 30)).toEqual({ a: 6, b: 6 });
  });
});

describe('clampSelection', () => {
  const free = { a: 6, b: 10 };
  it('orders the two ends (dragging backwards)', () => { expect(clampSelection(free, 9, 7)).toEqual({ a: 7, b: 9 }); });
  it('clamps both ends to the free stretch', () => {
    expect(clampSelection(free, 3, 8)).toEqual({ a: 6, b: 8 });
    expect(clampSelection(free, 8, 25)).toEqual({ a: 8, b: 10 });
    expect(clampSelection(free, 1, 25)).toEqual({ a: 6, b: 10 });
  });
  it('rounds to 0.1 s like the trim handles', () => { expect(clampSelection(free, 6.04, 8.26)).toEqual({ a: 6, b: 8.3 }); });
  it('a drag entirely outside the stretch collapses to its edge', () => { expect(clampSelection(free, 11, 12)).toEqual({ a: 10, b: 10 }); });
});
