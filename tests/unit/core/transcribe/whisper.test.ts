import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseWhisperJson, filterHallucinations, HALLUCINATION_PHRASES, MIN_MEAN_TOKEN_P, type Transcript,
} from '../../../../src/core/transcribe/whisper.js';

const fixture = JSON.parse(readFileSync('tests/fixtures/whisper/dolphins-en.json', 'utf-8'));

describe('parseWhisperJson (real whisper-cli -ojf output)', () => {
  const t = parseWhisperJson(fixture);

  it('reads the detected language', () => {
    expect(t.language).toBe('en');
  });

  it('turns segments into seconds, drops the empty [_BEG_] segment, trims text', () => {
    expect(t.segments.map((s) => [s.start, s.end, s.text])).toEqual([
      [0, 1.4, 'Look at the dolphins.'],
      [1.4, 3.2, 'They are swimming right next to the boat.'],
    ]);
    expect(t.segments[0].p).toBeGreaterThan(0.8);
  });

  it('builds words from tokens: sub-word pieces joined, punctuation attached, specials skipped', () => {
    const w = t.words.map((x) => x.text);
    expect(w).toEqual(['Look', 'at', 'the', 'dolphins.', 'They', 'are', 'swimming', 'right', 'next', 'to', 'the', 'boat.']);
    expect(t.words[0]).toMatchObject({ start: 0.01, end: 0.28 });
    expect(t.words[3]).toMatchObject({ start: 0.63, end: 0.99 });
    expect(t.words[0].p).toBeCloseTo(0.8975, 3);
  });

  it('joins sub-word tokens without a leading space into one word', () => {
    const raw = { result: { language: 'de' }, transcription: [{
      offsets: { from: 0, to: 1000 }, text: ' Delfine',
      tokens: [
        { text: ' Del', offsets: { from: 0, to: 400 }, p: 0.9 },
        { text: 'fine', offsets: { from: 400, to: 1000 }, p: 0.7 },
      ],
    }] };
    const r = parseWhisperJson(raw);
    expect(r.words).toEqual([{ start: 0, end: 1, text: 'Delfine', p: 0.8 }]);
  });
});

describe('filterHallucinations', () => {
  const seg = (start: number, end: number, text: string, p = 0.9) => ({ start, end, text, p });
  const word = (start: number, end: number, text: string) => ({ start, end, text, p: 0.9 });
  const base = (segments: Transcript['segments'], words: Transcript['words'] = []): Transcript => ({ language: 'de', segments, words });

  it('keeps normal speech', () => {
    const t = base([seg(0, 2, 'Schau mal, Delfine!')]);
    expect(filterHallucinations(t).segments).toHaveLength(1);
  });

  it('drops empty and punctuation-only segments', () => {
    const t = base([seg(0, 1, ''), seg(1, 2, ' ... '), seg(2, 3, '♪'), seg(3, 4, '—?!'), seg(4, 5, 'ok')]);
    expect(filterHallucinations(t).segments.map((s) => s.text)).toEqual(['ok']);
  });

  it('drops segments with very low mean token probability', () => {
    const t = base([seg(0, 2, 'Brabbel', MIN_MEAN_TOKEN_P - 0.01), seg(2, 4, 'Delfine', MIN_MEAN_TOKEN_P + 0.2)]);
    expect(filterHallucinations(t).segments.map((s) => s.text)).toEqual(['Delfine']);
  });

  it('drops known filler phrases (case/punctuation-insensitive) and keeps the list in one constant', () => {
    expect(HALLUCINATION_PHRASES.length).toBeGreaterThan(3);
    const t = base([
      seg(0, 2, 'Untertitel im Auftrag des ZDF, 2020'),
      seg(2, 4, 'Vielen Dank fürs Zuschauen!'),
      seg(4, 6, 'Thanks for watching.'),
      seg(6, 8, 'Wir fahren raus aufs Meer.'),
    ]);
    expect(filterHallucinations(t).segments.map((s) => s.text)).toEqual(['Wir fahren raus aufs Meer.']);
  });

  it('drops the words that lie inside a dropped segment', () => {
    const t = base(
      [seg(0, 2, 'Thanks for watching.'), seg(2, 4, 'Hallo Welt')],
      [word(0, 0.5, 'Thanks'), word(0.5, 1, 'for'), word(1, 2, 'watching.'), word(2, 3, 'Hallo'), word(3, 4, 'Welt')],
    );
    expect(filterHallucinations(t).words.map((w) => w.text)).toEqual(['Hallo', 'Welt']);
  });

  it('segments without p are kept (p is optional)', () => {
    const t = base([{ start: 0, end: 1, text: 'Hallo' }]);
    expect(filterHallucinations(t).segments).toHaveLength(1);
  });
});
