import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { evaluateShakes, type Verdicts } from '../../../../src/core/motion/eval.js';

const verdicts: Verdicts = {
  'A.MP4@1': { verdict: 'yes', end: 2 },
  'A.MP4@5': { verdict: 'no', end: 6 },
  'B.MP4@3': { verdict: 'yes', end: 4 },
  'B.MP4@9': { verdict: 'no', end: 10 },
};

describe('evaluateShakes', () => {
  it('precision / recall over the judged candidates: a candidate is kept when a detection overlaps it', () => {
    const r = evaluateShakes([
      { file: 'A.MP4', start: 1.2, end: 1.8 }, // hits yes A@1
      { file: 'A.MP4', start: 5.5, end: 5.9 }, // hits no  A@5
      { file: 'B.MP4', start: 8, end: 8.5 },   // overlaps nothing -> unjudged
    ], verdicts);
    expect(r).toEqual({ judged: 4, yes: 2, kept: 2, kept_yes: 1, precision: 0.5, recall: 0.5, unjudged: 1 });
  });
  it('detections in another file or merely touching do not match', () => {
    const r = evaluateShakes([{ file: 'B.MP4', start: 2, end: 3 }, { file: 'A.MP4', start: 2, end: 3 }], verdicts);
    expect(r).toMatchObject({ kept: 0, kept_yes: 0, recall: 0, unjudged: 2 });
    expect(r.precision).toBe(0);
  });
  it('the shipped fixture has the 141 verdicts of the user (100 yes)', () => {
    const v = JSON.parse(fs.readFileSync(new URL('../../../fixtures/shakes/arrifana-verdicts.json', import.meta.url), 'utf8')) as Verdicts;
    expect(Object.keys(v)).toHaveLength(141);
    expect(Object.values(v).filter((x) => x.verdict === 'yes')).toHaveLength(100);
    expect(Object.keys(v).every((k) => /^[^@]+\.\w+@\d+(\.\d+)?$/.test(k))).toBe(true);
  });
});
