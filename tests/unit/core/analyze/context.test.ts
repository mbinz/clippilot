import { describe, it, expect } from 'vitest';
import { buildMeasuredContext, SPOKEN_MAX_CHARS } from '../../../../src/core/analyze/context.js';

const jolt = (s: number, e: number, confidence: 'high' | 'low' = 'high') => ({ start_sec: s, end_sec: e, confidence });
const sent = (start: number, end: number, text: string) => ({ start, end, text });

describe('buildMeasuredContext', () => {
  it('null when there is nothing measured or spoken', () => {
    expect(buildMeasuredContext({ shakes: [], continuous: false, sentences: [] })).toBeNull();
  });

  it('jolts only: times with strength (high = stark, low = schwach), no spoken line', () => {
    const t = buildMeasuredContext({ shakes: [jolt(4.74, 4.94), jolt(8.02, 8.14, 'low')], continuous: false, sentences: [] })!;
    expect(t).toContain('Kamerawackler (gemessen): 4.74–4.94 s (stark), 8.02–8.14 s (schwach)');
    expect(t).not.toContain('Gesprochen');
  });

  it('speech only: sentences with times, no jolt line', () => {
    const t = buildMeasuredContext({ shakes: [], continuous: false, sentences: [sent(3.1, 7.8, '1, 2, 3, 4, 5, 9.')] })!;
    expect(t).toContain('Gesprochen (Transkript): [3.1–7.8 s] "1, 2, 3, 4, 5, 9."');
    expect(t).not.toContain('Kamerawackler');
  });

  it('both parts', () => {
    const t = buildMeasuredContext({ shakes: [jolt(1, 1.2)], continuous: false, sentences: [sent(0, 2, 'Hallo.')] })!;
    expect(t).toContain('Kamerawackler');
    expect(t).toContain('Gesprochen');
  });

  it('a continuously shaky clip says so in words', () => {
    const t = buildMeasuredContext({ shakes: [], continuous: true, sentences: [] })!;
    expect(t).toMatch(/durchgehend verwackelt/);
    expect(t).not.toContain('Kamerawackler');
  });

  it('long transcripts are cut evenly (every n-th sentence) to the limit and the text says so', () => {
    const sentences = Array.from({ length: 100 }, (_, i) => sent(i * 3, i * 3 + 2, `Das ist der Satz Nummer ${i}.`));
    const t = buildMeasuredContext({ shakes: [], continuous: false, sentences })!;
    const spoken = t.split('\n').find((l) => l.startsWith('Gesprochen'))!;
    expect(spoken.length).toBeLessThanOrEqual(SPOKEN_MAX_CHARS + 120);
    expect(spoken).toMatch(/gekürzt/);
    expect(spoken).toContain('Nummer 0.');           // first sentence stays
    expect(spoken).not.toContain('Nummer 1.');       // thinned
    expect(spoken).toMatch(/Nummer [5-9]\d\./);      // later sentences are still represented
  });

  it('a short transcript is not marked as cut', () => {
    const t = buildMeasuredContext({ shakes: [], continuous: false, sentences: [sent(0, 2, 'Hallo.')] })!;
    expect(t).not.toMatch(/gekürzt/);
  });
});
