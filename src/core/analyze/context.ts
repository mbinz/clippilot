/** Room for the spoken-sentences line of the measured-context block (A2). */
export const SPOKEN_MAX_CHARS = 1500;

export interface ContextInput {
  shakes: { start_sec: number; end_sec: number; confidence: 'high' | 'low' }[];
  /** The whole clip is continuously shaky (handheld jitter): no single jolts to point at. */
  continuous: boolean;
  sentences: { start: number; end: number; text: string }[];
}

const ordinal = (n: number) => `${n}.`;

/** Spoken sentences as `[3.1–7.8 s] "text"`, every n-th one when the whole transcript does not fit. */
function spokenLine(sentences: ContextInput['sentences']): string {
  const fmt = (s: ContextInput['sentences'][number]) => `[${s.start.toFixed(1)}–${s.end.toFixed(1)} s] "${s.text.trim()}"`;
  const all = sentences.map(fmt);
  const total = all.reduce((n, l) => n + l.length + 1, 0);
  if (total <= SPOKEN_MAX_CHARS) return `Gesprochen (Transkript): ${all.join(' ')}`;
  // Evenly thinned: keep every n-th sentence, n as small as the budget allows.
  let step = Math.ceil(total / SPOKEN_MAX_CHARS);
  let kept = all.filter((_, i) => i % step === 0);
  while (kept.join(' ').length > SPOKEN_MAX_CHARS && kept.length > 1) { step++; kept = all.filter((_, i) => i % step === 0); }
  return `Gesprochen (Transkript, gekürzt: nur jeder ${ordinal(step)} Satz): ${kept.join(' ')}`;
}

/**
 * A2: what was measured about a clip, as text for the analysis prompt: camera jolts (strong = high confidence),
 * "continuously shaky", and the spoken sentences. Only the parts that exist; null when there is nothing to say.
 */
export function buildMeasuredContext(c: ContextInput): string | null {
  const lines: string[] = [];
  if (c.shakes.length > 0) {
    const list = c.shakes.map((k) => `${k.start_sec.toFixed(2)}–${k.end_sec.toFixed(2)} s (${k.confidence === 'high' ? 'stark' : 'schwach'})`);
    lines.push(`Kamerawackler (gemessen): ${list.join(', ')}`);
  }
  if (c.continuous) lines.push('Der ganze Clip ist durchgehend verwackelt (Handkamera-Zittern); einzelne Wackler lassen sich nicht abgrenzen.');
  if (c.sentences.length > 0) lines.push(spokenLine(c.sentences));
  if (lines.length === 0) return null;
  return ['Gemessene Daten zu diesem Clip (aus Bildanalyse und Ton, verlässlicher als dein Eindruck):', ...lines].join('\n');
}
