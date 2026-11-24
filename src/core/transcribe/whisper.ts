/** Parsing and cleaning of whisper.cpp's full JSON output (`whisper-cli -ojf`). All times in seconds (clip time). */

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  /** Mean token probability (0..1), when known. */
  p?: number;
}

export interface TranscriptWord {
  start: number;
  end: number;
  text: string;
  p: number;
}

export interface Transcript {
  language: string;
  segments: TranscriptSegment[];
  words: TranscriptWord[];
}

/** Segments with a lower mean token probability are treated as hallucinated. */
export const MIN_MEAN_TOKEN_P = 0.3;

/** Phrases whisper invents on silence / music (compared lower-case, without punctuation). Add new ones here. */
export const HALLUCINATION_PHRASES: string[] = [
  'untertitel im auftrag des zdf',
  'untertitel der amara org community',
  'untertitelung des zdf',
  'vielen dank fürs zuschauen',
  'vielen dank für s zuschauen',
  'danke fürs zuschauen',
  'bis zum nächsten mal',
  'thanks for watching',
  'thank you for watching',
  'thank you',
  'please subscribe',
  'subtitles by the amara org community',
  'musik',
  'music',
];

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const ms = (n: unknown) => round3(Number(n) / 1000);

interface RawToken { text: string; offsets: { from: number; to: number }; p?: number }
interface RawSegment { text: string; offsets: { from: number; to: number }; tokens?: RawToken[] }

const isSpecial = (t: string) => /^\[_.*\]$/.test(t) || /^<\|.*\|>$/.test(t);
const hasLetterOrDigit = (s: string) => /[\p{L}\p{N}]/u.test(s);

/** Parse whisper.cpp JSON (`-ojf`): segments, and words rebuilt from tokens (a token starting with a space starts a word). */
export function parseWhisperJson(raw: any): Transcript {
  const language: string = raw?.result?.language ?? 'unknown';
  const segments: TranscriptSegment[] = [];
  const words: TranscriptWord[] = [];

  for (const s of (raw?.transcription ?? []) as RawSegment[]) {
    const text = String(s.text ?? '').trim();
    const tokens = (s.tokens ?? []).filter((t) => !isSpecial(t.text));
    const probs = tokens.map((t) => t.p).filter((p): p is number => typeof p === 'number');
    if (text !== '') {
      const seg: TranscriptSegment = { start: ms(s.offsets.from), end: ms(s.offsets.to), text };
      if (probs.length) seg.p = round3(probs.reduce((a, b) => a + b, 0) / probs.length);
      segments.push(seg);
    }

    let cur: { start: number; end: number; text: string; ps: number[] } | null = null;
    const flush = () => {
      if (cur) words.push({ start: cur.start, end: cur.end, text: cur.text, p: round3(cur.ps.reduce((a, b) => a + b, 0) / cur.ps.length) });
      cur = null;
    };
    for (const t of tokens) {
      const piece = t.text;
      if (piece.trim() === '') continue;
      const p = t.p ?? 0;
      if (cur && !piece.startsWith(' ')) {
        cur.text += piece;
        // Punctuation timing is unreliable: it extends the text, not the word.
        if (hasLetterOrDigit(piece)) { cur.end = ms(t.offsets.to); cur.ps.push(p); }
      } else {
        flush();
        cur = { start: ms(t.offsets.from), end: ms(t.offsets.to), text: piece.trim(), ps: [p] };
      }
    }
    flush();
  }
  return { language, segments, words };
}

const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Whether a segment looks like whisper's silence / music hallucination. */
export function isHallucination(seg: TranscriptSegment): boolean {
  if (!hasLetterOrDigit(seg.text)) return true;
  if (seg.p !== undefined && seg.p < MIN_MEAN_TOKEN_P) return true;
  const n = normalize(seg.text);
  return HALLUCINATION_PHRASES.some((ph) => n === ph || n.startsWith(`${ph} `));
}

/** Drop hallucinated segments and the words that lie inside them. */
export function filterHallucinations(t: Transcript): Transcript {
  const dropped = t.segments.filter(isHallucination);
  const segments = t.segments.filter((s) => !dropped.includes(s));
  const words = t.words.filter((w) => {
    const mid = (w.start + w.end) / 2;
    return !dropped.some((d) => mid >= d.start && mid <= d.end);
  });
  return { ...t, segments, words };
}
