import { describe, it, expect } from 'vitest';
import { renderReviewHtml } from '../../../../src/core/review/review-html.js';
import type { ReviewData } from '../../../../src/core/review/review-data.js';

const evil = '</script><script>alert(1)</script> <!-- x   y';

const data: ReviewData = {
  project: 'P',
  generated_at: '2026-02-02T00:00:00Z',
  clips: [{
    clip_id: 1, file_name: 'a.mp4', file_path: '/v/a.mp4', scene_hint: 'A', duration_sec: 10,
    proxy_url: 'file:///p/a.mp4', ai_summary: 's', places: ['beach'], moments: ['surf'],
    fps: 25,
    highlights: [{ highlight_id: 5, start_sec: 1, end_sec: 3, description: evil, tier: 'solid', shot: 'wide', role: 'action', issues: [], slowmo: 'none', slowmo_reason: '', suggested_speed: 1 }],
  }],
};

function embedded(html: string): string {
  const m = html.match(/<script type="application\/json" id="review-data">([\s\S]*?)<\/script>/);
  expect(m).not.toBeNull();
  return m![1];
}

describe('renderReviewHtml', () => {
  const html = renderReviewHtml(data);

  it('embeds the data in a JSON script tag that round-trips', () => {
    expect(JSON.parse(embedded(html))).toEqual(data);
  });

  it('does not let descriptions break out of the data block', () => {
    const start = html.indexOf('id="review-data"');
    const end = html.indexOf('</script>', start);
    const block = html.slice(start, end);
    expect(block).not.toContain('<script');
    expect(block).not.toContain('<!--');
    expect(block).not.toContain(' ');
    const after = html.slice(end + '</script>'.length);
    expect(after).not.toContain('alert(1)');
  });

  it('is self-contained (no external resources)', () => {
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+href=/);
  });
});
