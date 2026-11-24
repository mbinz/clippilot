import type { TranscriptSegment, TranscriptWord } from './whisper.js';

export type SpeechCut = null | 'start' | 'end' | 'both';

export const SENTENCE_END = /[.?!…]["'”“»)\]]*$/u;

/**
 * Sentences derived from word timings (whisper+VAD segments can be one clip long). A sentence ends after a word that
 * ends in . ? ! … or when the pause to the next word is >= maxPauseSec.
 */
export function sentencesFromWords(
  words: TranscriptWord[],
  opts: { maxPauseSec?: number } = {},
): { start: number; end: number; text: string }[] {
  const maxPause = opts.maxPauseSec ?? 0.7;
  const out: { start: number; end: number; text: string }[] = [];
  let cur: TranscriptWord[] = [];
  const flush = () => {
    if (cur.length === 0) return;
    out.push({ start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map((w) => w.text).join(' ') });
    cur = [];
  };
  words.forEach((w, i) => {
    cur.push(w);
    const next = words[i + 1];
    if (SENTENCE_END.test(w.text.trim()) || !next || next.start - w.end >= maxPause - 1e-9) flush();
  });
  return out;
}

/** The speech units everything downstream uses: sentences from words, or the raw segments when there are no words. */
export function transcriptSentences(
  segments: TranscriptSegment[],
  words: TranscriptWord[],
): { start: number; end: number; text: string }[] {
  return words.length > 0 ? sentencesFromWords(words) : segments;
}

/**
 * What is said inside [start, end] of a clip, and whether the range cuts a sentence: `cut` names the boundary(ies)
 * that fall inside a segment. Words count when their midpoint is inside the range (segment text when there are no words).
 */
export function speechForRange(
  segments: TranscriptSegment[],
  words: TranscriptWord[],
  start: number,
  end: number,
): { text: string; cut: SpeechCut } {
  const sentences = transcriptSentences(segments, words);
  const cutStart = sentences.some((s) => s.start < start && start < s.end);
  const cutEnd = sentences.some((s) => s.start < end && end < s.end);
  const cut: SpeechCut = cutStart && cutEnd ? 'both' : cutStart ? 'start' : cutEnd ? 'end' : null;

  const text = words.length > 0
    ? words.filter((w) => { const m = (w.start + w.end) / 2; return m >= start && m < end; }).map((w) => w.text).join(' ')
    : segments.filter((s) => s.end > start && s.start < end).map((s) => s.text).join(' ');
  return { text, cut };
}

/**
 * A range that cuts into speech is widened to the start of the segment at its start and the end of the segment at its
 * end. No upper length cap; clamped to [0, durationSec] when given. Ranges that touch no speech are returned as is.
 */
export function snapToSpeech(
  range: { start: number; end: number },
  segments: TranscriptSegment[],
  durationSec?: number,
): { start: number; end: number; extended: boolean } {
  let { start, end } = range;
  const atStart = segments.find((s) => s.start < range.start && range.start < s.end);
  const atEnd = segments.find((s) => s.start < range.end && range.end < s.end);
  if (!atStart && !atEnd) return { start, end, extended: false };
  if (atStart) start = atStart.start;
  if (atEnd) end = atEnd.end;
  start = Math.max(0, start);
  if (durationSec !== undefined) end = Math.min(durationSec, end);
  return { start, end, extended: true };
}
