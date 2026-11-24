import { describe, it, expect } from 'vitest';
import { speechForRange, snapToSpeech } from '../../../../src/core/transcribe/speech.js';

const segments = [
  { start: 2, end: 6, text: 'Schau mal die Delfine.' },
  { start: 10, end: 14, text: 'Sie schwimmen neben dem Boot.' },
];
const words = [
  { start: 2, end: 3, text: 'Schau', p: 0.9 }, { start: 3, end: 3.5, text: 'mal', p: 0.9 },
  { start: 3.5, end: 4.5, text: 'die', p: 0.9 }, { start: 4.5, end: 6, text: 'Delfine.', p: 0.9 },
  { start: 10, end: 11, text: 'Sie', p: 0.9 }, { start: 11, end: 12, text: 'schwimmen', p: 0.9 },
  { start: 12, end: 13, text: 'neben', p: 0.9 }, { start: 13, end: 14, text: 'dem Boot.', p: 0.9 },
];

describe('speechForRange', () => {
  it('range inside a segment: the words in it, cut = both (the segment crosses both edges)', () => {
    expect(speechForRange(segments, words, 3, 5)).toEqual({ text: 'mal die', cut: 'both' });
  });

  it('range covering a whole segment: full text, no cut', () => {
    expect(speechForRange(segments, words, 1, 7)).toEqual({ text: 'Schau mal die Delfine.', cut: null });
  });

  it('range crossing only the start of a segment', () => {
    expect(speechForRange(segments, words, 3, 8)).toEqual({ text: 'mal die Delfine.', cut: 'start' });
  });

  it('range crossing only the end of a segment', () => {
    expect(speechForRange(segments, words, 0, 4)).toEqual({ text: 'Schau mal', cut: 'end' });
  });

  it('range spanning two segments, cut at the far ends', () => {
    expect(speechForRange(segments, words, 4, 12)).toEqual({ text: 'die Delfine. Sie schwimmen', cut: 'both' });
  });

  it('range without speech', () => {
    expect(speechForRange(segments, words, 7, 9)).toEqual({ text: '', cut: null });
  });

  it('falls back to segment text when there are no words', () => {
    expect(speechForRange(segments, [], 1, 7)).toEqual({ text: 'Schau mal die Delfine.', cut: null });
  });

  it('a range that merely touches a segment edge has no speech and no cut', () => {
    expect(speechForRange(segments, words, 6, 8)).toEqual({ text: '', cut: null });
  });
});

describe('snapToSpeech', () => {
  it('widens start to the segment start and end to the segment end', () => {
    expect(snapToSpeech({ start: 3, end: 11 }, segments)).toEqual({ start: 2, end: 14, extended: true });
  });

  it('has no upper length cap', () => {
    const long = [{ start: 0, end: 60, text: 'Eine lange Rede' }];
    expect(snapToSpeech({ start: 20, end: 24 }, long)).toEqual({ start: 0, end: 60, extended: true });
  });

  it('clamps to the clip', () => {
    expect(snapToSpeech({ start: 3, end: 4 }, [{ start: -1, end: 9, text: 'x' }], 8)).toEqual({ start: 0, end: 8, extended: true });
  });

  it('leaves a range untouched when it does not cut into speech', () => {
    expect(snapToSpeech({ start: 7, end: 9 }, segments)).toEqual({ start: 7, end: 9, extended: false });
    expect(snapToSpeech({ start: 1, end: 7 }, segments)).toEqual({ start: 1, end: 7, extended: false });
  });

  it('is untouched without speech', () => {
    expect(snapToSpeech({ start: 3, end: 5 }, [])).toEqual({ start: 3, end: 5, extended: false });
  });
});
