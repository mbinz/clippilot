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
    expect(t.words[0].p).toBeCloseTo(0.9, 2);
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
    const t = base([seg(0, 2, 'Brabbel', MIN_MEAN_TOKEN_P - 0.01), seg(2, 4, 'Delfine', 0.7)]);
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

import { classifySegment, filterHallucinationsWithStats } from '../../../../src/core/transcribe/whisper.js';
import { whisperArgs } from '../../../../src/core/transcribe/runner.js';

describe('T1b hallucination rules (real Arrifana junk)', () => {
  const seg = (text: string, p = 0.9) => ({ start: 0, end: 3, text, p });
  const reason = (text: string, p = 0.9) => classifySegment(seg(text, p));

  it('keeps genuine speech', () => {
    expect(reason('Schau mal, da sind zwei Delfine direkt neben dem Boot.')).toBeNull();
    expect(reason('Vielen Dank, das war ein schöner Tag am Strand.')).toBeNull();
    expect(reason('Ja, genau.', 0.9)).toBeNull();
  });

  it('drops sound descriptions in *…*, […], (…) and ♪', () => {
    for (const t of ['*sad music*', '*Loud noise*', '*Burrish noise*', '*Klärgeräusche*', '[Music]', '(wind blowing)', '♪ la la ♪', '♪'])
      expect(reason(t), t).not.toBeNull();
    expect(reason('*sad music*')).toBe('sound_description');
  });

  it('does not drop speech that merely contains brackets', () => {
    expect(reason('Das ist (glaube ich) der Hafen von Sagres.')).toBeNull();
  });

  it('drops n-grams repeated three or more times in a row (words and CJK characters)', () => {
    expect(reason('The first time I was in the middle of the road, I was in the middle of the road, I was in the middle of the road, I was in the middle of the road')).toBe('repetition');
    expect(reason('東京都道府 東京都道府 東京都道府 東京都道府')).toBe('repetition');
    expect(reason('ja ja ja')).toBe('repetition');
    expect(reason('no no no no')).toBe('repetition');
  });

  it('keeps text with a phrase repeated only twice', () => {
    expect(reason('Schau mal schau mal, Delfine!')).toBeNull();
  });

  it('drops very short segments (<= 2 words) with mean token p below 0.6', () => {
    expect(reason('- Okay.', 0.5)).toBe('short_low_p');
    expect(reason('Please.', 0.55)).not.toBeNull();
    expect(reason('Okay.', 0.8)).toBeNull();
    expect(reason('Wir fahren raus aufs Meer.', 0.5)).toBeNull();
  });

  it('drops the added filler phrases, normalised', () => {
    for (const t of ['ご視聴ありがとうございました', 'Продолжение следует...', 'Altyazı M.K.', 'Să vă mulțumim pentru vizionare.',
      "I'll see you next time.", 'Vielen Dank.', 'Please.'])
      expect(reason(t), t).not.toBeNull();
    expect(reason('Vielen Dank.')).toBe('phrase');
  });

  it('filterHallucinationsWithStats counts dropped segments by reason', () => {
    const t = { language: 'de', words: [], segments: [seg('*sad music*'), seg('Vielen Dank.'), seg('Thanks for watching.'), seg('Schau mal, Delfine!')] };
    const r = filterHallucinationsWithStats(t);
    expect(r.transcript.segments.map((s) => s.text)).toEqual(['Schau mal, Delfine!']);
    expect(r.dropped).toEqual({ sound_description: 1, phrase: 2 });
  });
});

describe('whisperArgs', () => {
  it('always suppresses non-speech tokens, drops text context, auto-detects language', () => {
    const a = whisperArgs('m.bin', 'a.wav', '/o');
    expect(a).toEqual(expect.arrayContaining(['-sns', '-l', 'auto', '-ojf']));
    expect(a[a.indexOf('-mc') + 1]).toBe('0');
    expect(a).not.toContain('--vad');
  });

  it('adds --vad -vm <path> when a VAD model is given', () => {
    const a = whisperArgs('m.bin', 'a.wav', '/o', '/v/silero.bin');
    expect(a).toEqual(expect.arrayContaining(['--vad', '-vm', '/v/silero.bin']));
    expect(a[a.indexOf('-vm') + 1]).toBe('/v/silero.bin');
  });
});
