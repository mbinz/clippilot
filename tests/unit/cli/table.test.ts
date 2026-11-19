import { describe, it, expect } from 'vitest';
import { formatClipTable } from '../../../src/cli/formatters/table.js';
import type { Clip } from '../../../src/types/clip.js';

const clip = { id: 7, file_path: '/v/a.mp4', duration_sec: 12, ai_summary: 'Strand' } as Clip;

describe('formatClipTable', () => {
  it('shows the best moment tier instead of clip scores', () => {
    const out = formatClipTable([clip], new Map([[7, 'hero']]));
    expect(out).toContain('Best');
    expect(out).toContain('hero');
    expect(out).not.toContain('Quality');
    expect(out).not.toContain('Use');
  });
  it('shows - when a clip has no moments', () => {
    expect(formatClipTable([clip])).toMatch(/-/);
  });
});
