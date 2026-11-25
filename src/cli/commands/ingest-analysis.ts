/** After an ingest: run the analysis on the new clips (unless skipped), never failing the ingest. */
export interface AfterIngestArgs {
  newClipIds: number[];
  skipAnalysis: boolean;
  hasKey: boolean;
  /** The same analysis as `clippilot analyze`, restricted to these clips. */
  run: (clipIds: number[]) => Promise<void>;
  log: (line: string) => void;
}

const LATER = 'Run "clippilot analyze" later.';

export async function analyzeAfterIngest(a: AfterIngestArgs): Promise<void> {
  if (a.skipAnalysis || a.newClipIds.length === 0) return;
  if (!a.hasKey) {
    a.log(`Analysis skipped: no Gemini API key configured. ${LATER}`);
    return;
  }
  try {
    await a.run(a.newClipIds);
  } catch (err) {
    a.log(`Analysis failed: ${err instanceof Error ? err.message : String(err)}. ${LATER}`);
  }
}
