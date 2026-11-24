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

/** Segments of at most this many words need a better mean token probability than long ones. */
export const SHORT_SEGMENT_MAX_WORDS = 2;
export const MIN_SHORT_SEGMENT_P = 0.6;

/** An n-gram (n = 1..REPEAT_MAX_N words or CJK characters) repeated this many times in a row marks a decoder loop. */
export const REPEAT_MIN_COUNT = 3;
export const REPEAT_MAX_N = 8;
/** One n-gram repeated at least twice that covers this share of a segment's words also marks a loop ("THE END OF THE END OF THE"). */
export const REPEAT_COVERAGE = 0.8;
/** Kids repeat short phrases on purpose ("Ja, ja, ja"): segments up to this many words are exempt from the 3x rule; the coverage rule needs at least REPEAT_COVERAGE_MIN_WORDS. */
export const REPEAT_EXEMPT_MAX_WORDS = 4;
export const REPEAT_COVERAGE_MIN_WORDS = 6;

/**
 * Phrases whisper invents on silence / music / wind (lower-case, punctuation removed). A segment is dropped when it is
 * exactly the phrase or starts with it followed by more text ("Thanks for watching, see you"). Add new ones here.
 */
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
  'please subscribe',
  'subtitles by the amara org community',
  'ご視聴ありがとうございました',
  'продолжение следует',
  'altyazı m k',
  'să vă mulțumim pentru vizionare',
  'i ll see you next time',
];

/** Short generic phrases that are only hallucinations when they are the whole segment ("Vielen Dank, das war schön" is speech). */
export const HALLUCINATION_EXACT_PHRASES: string[] = [
  'thank you', 'thanks', 'vielen dank', 'danke', 'please', 'musik', 'music',
  // Classic English hallucinations on wind; their token p is high, so only the text can catch them.
  'i m going to go', 'i m going to go to the next one', 'you', 'oh', 'i m sorry', 'oh my god', 'bye',
  'we ll be right back', 'we ll see you next time', 'see you next time',
];

/** A segment that is entirely a sound description: *…*, […], (…) or ♪…. */
export const SOUND_DESCRIPTION = /^\s*(?:\*[^*]+\*|\[[^\]]+\]|\([^)]+\)|♪.*)\s*$/u;

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

export const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export type DropReason = 'cross_clip' | 'empty' | 'low_p' | 'sound_description' | 'phrase' | 'repetition' | 'short_low_p';

/** Words, or single CJK characters, of a text (lower-case). */
function unitsOf(text: string): string[] {
  return text.toLowerCase().match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[^\s\p{P}\p{S}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu) ?? [];
}

function hasLoop(units: string[]): boolean {
  if (units.length <= REPEAT_EXEMPT_MAX_WORDS) return false;
  for (let n = 1; n <= REPEAT_MAX_N; n++) {
    for (let i = 0; i + n * 2 <= units.length; i++) {
      let reps = 1;
      while (i + n * (reps + 1) <= units.length
        && units.slice(i, i + n).every((u, k) => u === units[i + n * reps + k])) reps++;
      if (reps >= REPEAT_MIN_COUNT || (reps >= 2 && units.length >= REPEAT_COVERAGE_MIN_WORDS && (reps * n) / units.length >= REPEAT_COVERAGE)) return true;
    }
  }
  return false;
}

/** Why a segment looks like a silence / music / wind hallucination, or null for real speech. */
export function classifySegment(seg: TranscriptSegment): DropReason | null {
  if (!hasLetterOrDigit(seg.text)) return 'empty';
  if (SOUND_DESCRIPTION.test(seg.text)) return 'sound_description';
  if (seg.p !== undefined && seg.p < MIN_MEAN_TOKEN_P) return 'low_p';
  const n = normalize(seg.text);
  if (HALLUCINATION_EXACT_PHRASES.includes(n) || HALLUCINATION_PHRASES.some((ph) => n === ph || n.startsWith(`${ph} `))) return 'phrase';
  const units = unitsOf(seg.text);
  if (hasLoop(units)) return 'repetition';
  if (seg.p !== undefined && seg.p < MIN_SHORT_SEGMENT_P && units.length <= SHORT_SEGMENT_MAX_WORDS) return 'short_low_p';
  return null;
}

/** Whether a segment looks like whisper's silence / music hallucination. */
export function isHallucination(seg: TranscriptSegment): boolean {
  return classifySegment(seg) !== null;
}

/** Drop hallucinated segments and the words that lie inside them; also counts the drops by reason. */
export function filterHallucinationsWithStats(t: Transcript): { transcript: Transcript; dropped: Partial<Record<DropReason, number>> } {
  const dropped: Partial<Record<DropReason, number>> = {};
  const gone: TranscriptSegment[] = [];
  const segments = t.segments.filter((s) => {
    const r = classifySegment(s);
    if (r === null) return true;
    dropped[r] = (dropped[r] ?? 0) + 1;
    gone.push(s);
    return false;
  });
  const words = t.words.filter((w) => {
    const mid = (w.start + w.end) / 2;
    return !gone.some((d) => mid >= d.start && mid <= d.end);
  });
  return { transcript: { ...t, segments, words }, dropped };
}

export function filterHallucinations(t: Transcript): Transcript {
  return filterHallucinationsWithStats(t).transcript;
}

/** A normalised text that occurs in segments of at least this many different clips of a project is not speech. */
export const CROSS_CLIP_MIN_CLIPS = 3;

/** Normalised texts that occur in >= CROSS_CLIP_MIN_CLIPS different clips (`byClip`: clip id -> its segments). */
export function crossClipTexts(byClip: Map<number, TranscriptSegment[]>): Set<string> {
  const clipsOf = new Map<string, Set<number>>();
  for (const [clipId, segs] of byClip) {
    for (const s of segs) {
      const n = normalize(s.text);
      if (n === '') continue;
      (clipsOf.get(n) ?? clipsOf.set(n, new Set()).get(n)!).add(clipId);
    }
  }
  return new Set([...clipsOf].filter(([, c]) => c.size >= CROSS_CLIP_MIN_CLIPS).map(([n]) => n));
}

/** Remove the segments with a repeated text (and their words); returns what is left and how many segments went. */
export function dropCrossClip(t: { segments: TranscriptSegment[]; words: TranscriptWord[] }, texts: Set<string>):
  { segments: TranscriptSegment[]; words: TranscriptWord[]; dropped: number } {
  const gone = t.segments.filter((s) => texts.has(normalize(s.text)));
  if (gone.length === 0) return { ...t, dropped: 0 };
  return {
    segments: t.segments.filter((s) => !gone.includes(s)),
    words: t.words.filter((w) => { const m = (w.start + w.end) / 2; return !gone.some((g) => m >= g.start && m <= g.end); }),
    dropped: gone.length,
  };
}
