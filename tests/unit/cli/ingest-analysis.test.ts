import { describe, it, expect, vi } from 'vitest';
import { analyzeAfterIngest } from '../../../src/cli/commands/ingest-analysis.js';

function setup(over: Partial<Parameters<typeof analyzeAfterIngest>[0]> = {}) {
  const run = vi.fn(async (_ids: number[]) => {});
  const lines: string[] = [];
  const args = { newClipIds: [4, 5], skipAnalysis: false, hasKey: true, run, log: (l: string) => lines.push(l), ...over };
  return { run, lines, args };
}

describe('analyzeAfterIngest', () => {
  it('runs analysis on exactly the new clips', async () => {
    const { run, args } = setup();
    await analyzeAfterIngest(args);
    expect(run).toHaveBeenCalledWith([4, 5]);
  });
  it('--skip-analysis: not invoked', async () => {
    const { run, lines, args } = setup({ skipAnalysis: true });
    await analyzeAfterIngest(args);
    expect(run).not.toHaveBeenCalled();
    expect(lines).toEqual([]);
  });
  it('no key: not invoked, one hint line', async () => {
    const { run, lines, args } = setup({ hasKey: false });
    await analyzeAfterIngest(args);
    expect(run).not.toHaveBeenCalled();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('clippilot analyze');
  });
  it('no new clips: nothing happens', async () => {
    const { run, lines, args } = setup({ newClipIds: [] });
    await analyzeAfterIngest(args);
    expect(run).not.toHaveBeenCalled();
    expect(lines).toEqual([]);
  });
  it('runner failure does not throw; warning + hint', async () => {
    const { lines, args } = setup({ run: async () => { throw new Error('boom'); } });
    await expect(analyzeAfterIngest(args)).resolves.toBeUndefined();
    expect(lines.join('\n')).toContain('boom');
    expect(lines.join('\n')).toContain('clippilot analyze');
  });
});
