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

import { sentencesFromWords, transcriptSentences } from '../../../../src/core/transcribe/speech.js';

const w = (start: number, end: number, text: string) => ({ start, end, text, p: 0.9 });

// C0599-like: one coarse whisper segment 0-44.6 over words that end at 22.3
const c0599Words = [
  w(0, 0.3, 'Auf.'), w(0.7, 0.9, 'Oh,'), w(1.7, 2.1, 'cool.'), w(3.1, 3.2, '1,'), w(3.3, 3.6, 'zwei'), w(3.7, 4.0, 'drei.'),
  w(8.2, 9.1, 'Toll.'), w(9.7, 10.0, 'Ich'), w(10.1, 10.4, 'habe'), w(10.7, 11.0, 'es.'),
  w(11.4, 11.8, 'Warte'), w(12.2, 12.6, 'mal.'),
  w(13.0, 13.5, 'Ich'), w(14.0, 14.5, 'muss'), w(21.2, 22.3, 'anziehen.'),
];
const c0599Segments = [{ start: 0, end: 44.6, text: 'whole clip' }];

describe('sentencesFromWords', () => {
  it('ends a sentence at terminal punctuation or a long pause; a comma alone does not end one', () => {
    const s = sentencesFromWords(c0599Words);
    expect(s).toEqual([
      { start: 0, end: 0.3, text: 'Auf.' },
      { start: 0.7, end: 0.9, text: 'Oh,' }, // 0.8 s pause to "cool." splits
      { start: 1.7, end: 2.1, text: 'cool.' },
      { start: 3.1, end: 4.0, text: '1, zwei drei.' },
      { start: 8.2, end: 9.1, text: 'Toll.' },
      { start: 9.7, end: 11.0, text: 'Ich habe es.' },
      { start: 11.4, end: 12.6, text: 'Warte mal.' },
      { start: 13.0, end: 14.5, text: 'Ich muss' }, // 6.7 s pause before "anziehen."
      { start: 21.2, end: 22.3, text: 'anziehen.' },
    ]);
  });

  it('splits on a pause >= maxPauseSec without punctuation', () => {
    const s = sentencesFromWords([w(0, 1, 'eins'), w(1.2, 2, 'zwei'), w(3, 4, 'drei')]);
    expect(s).toEqual([{ start: 0, end: 2, text: 'eins zwei' }, { start: 3, end: 4, text: 'drei' }]);
    expect(sentencesFromWords([w(0, 1, 'a'), w(1.5, 2, 'b')], { maxPauseSec: 0.4 })).toHaveLength(2);
    expect(sentencesFromWords([w(0, 1, 'a'), w(1.5, 2, 'b')])).toHaveLength(1);
  });

  it('handles ? ! … ?! and quotes after punctuation', () => {
    const s = sentencesFromWords([w(0, 1, 'Was?!'), w(1, 2, 'Nein…'), w(2, 3, 'Doch!'), w(3, 4, 'Ja.“'), w(4, 5, 'Hm')]);
    expect(s.map((x) => x.text)).toEqual(['Was?!', 'Nein…', 'Doch!', 'Ja.“', 'Hm']);
  });

  it('single word and empty input', () => {
    expect(sentencesFromWords([w(1, 2, 'Hallo')])).toEqual([{ start: 1, end: 2, text: 'Hallo' }]);
    expect(sentencesFromWords([])).toEqual([]);
  });
});

describe('transcriptSentences', () => {
  it('uses words when present, else the segments', () => {
    expect(transcriptSentences(c0599Segments, c0599Words)[0].text).toBe('Auf.');
    expect(transcriptSentences(c0599Segments, [])).toEqual(c0599Segments);
  });
});

describe('speech consumers use sentences', () => {
  it('speechForRange: a moment 8.5-21.0 over C0599 is cut only where a sentence crosses', () => {
    // 8.5 is inside "Toll." (8.2-9.1) -> start cut; 21.0 lies in silence, no sentence crosses it
    expect(speechForRange(c0599Segments, c0599Words, 9.3, 12.7).cut).toBe(null);
    expect(speechForRange(c0599Segments, c0599Words, 9.3, 12.7).text).toBe('Ich habe es. Warte mal.');
    expect(speechForRange(c0599Segments, c0599Words, 8.5, 21.0).cut).toBe('start');
    expect(speechForRange(c0599Segments, c0599Words, 9.2, 12.8).cut).toBe(null);
  });

  it('snapToSpeech over sentences widens to the sentence, not the whole clip', () => {
    const sentences = transcriptSentences(c0599Segments, c0599Words);
    expect(snapToSpeech({ start: 8.5, end: 10.5 }, sentences, 44.6)).toEqual({ start: 8.2, end: 11.0, extended: true });
    expect(snapToSpeech({ start: 9.2, end: 12.7 }, sentences, 44.6).extended).toBe(false);
  });
});
