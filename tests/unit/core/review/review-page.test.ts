import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderReviewHtml } from '../../../../src/core/review/review-html.js';
import type { ReviewData } from '../../../../src/core/review/review-data.js';

const data: ReviewData = {
  project: 'P',
  generated_at: '2026-02-02T00:00:00Z',
  clips: [
    {
      clip_id: 1, file_name: 'a.mp4', file_path: '/v/a.mp4', scene_hint: 'A', duration_sec: 30,
      proxy_url: 'file:///p/a.mp4', ai_summary: 'boat trip', places: [], moments: [],
      scores: {
        quality: { stability: 3, focus: 4, exposure: 4, composition: 3, audio: 2, overall: 3 },
        editorial: { emotional: 4, storytelling: 3, uniqueness: 2 },
        quality_issues: ['wind noise'], suggested_use: 'B-Roll',
      },
      highlights: [
        { highlight_id: 11, start_sec: 3, end_sec: 5, description: 'first', quality: 8 },
        { highlight_id: 12, start_sec: 10, end_sec: 12, description: 'second', quality: 7 },
        { highlight_id: 13, start_sec: 20, end_sec: 22, description: 'third', quality: 9 },
      ],
    },
    {
      clip_id: 2, file_name: 'b.mp4', file_path: '/v/b.mp4', scene_hint: 'A', duration_sec: 20,
      proxy_url: 'file:///p/b.mp4', ai_summary: 'empty', places: [], moments: [],
      scores: {
        quality: { stability: 5, focus: 5, exposure: 5, composition: 5, audio: 5, overall: 5 },
        editorial: { emotional: 1, storytelling: 1, uniqueness: 1 },
        quality_issues: [], suggested_use: null,
      },
      highlights: [],
    },
  ],
};

interface Page {
  win: any;
  doc: Document;
  api: { buildExport(): any };
  click(sel: string, root?: ParentNode): void;
  key(k: string, target?: Element): void;
  all(sel: string): Element[];
  video(): any;
  storage(): Record<string, string>;
}

function load(seed: Record<string, string> = {}): Page {
  const dom = new JSDOM(renderReviewHtml(data), {
    runScripts: 'dangerously',
    url: 'http://localhost/',
    pretendToBeVisual: true,
    beforeParse(win: any) {
      const proto = win.HTMLMediaElement.prototype;
      Object.defineProperty(proto, 'currentTime', {
        configurable: true,
        get() { return this.__t ?? 0; },
        set(v: number) { this.__t = v; },
      });
      proto.play = function () { this.__paused = false; return Promise.resolve(); };
      proto.pause = function () { this.__paused = true; };
      Object.defineProperty(proto, 'paused', { configurable: true, get() { return this.__paused !== false; } });
      for (const [k, v] of Object.entries(seed)) win.localStorage.setItem(k, v);
    },
  });
  const win = dom.window as any;
  const doc = win.document as Document;
  const all = (sel: string) => [...doc.querySelectorAll(sel)];
  return {
    win, doc, api: win.clippilotReview,
    click(sel, root = doc) {
      const e = (root as ParentNode).querySelector(sel) as HTMLElement | null;
      if (!e) throw new Error('no element ' + sel);
      e.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    },
    key(k, target = doc.body) {
      target.dispatchEvent(new win.KeyboardEvent('keydown', { key: k, bubbles: true }));
    },
    all,
    video: () => doc.querySelector('video'),
    storage() {
      const out: Record<string, string> = {};
      for (let i = 0; i < win.localStorage.length; i++) {
        const k = win.localStorage.key(i)!;
        out[k] = win.localStorage.getItem(k)!;
      }
      return out;
    },
  };
}

const card = (i: number) => `.h[data-i="${i}"]`;
const hl = (p: Page, id: number) => p.api.buildExport().highlights.find((h: any) => h.highlight_id === id);

describe('review page v2', () => {
  it('shows one clip at a time with position and a segmented progress bar', () => {
    const p = load();
    expect(p.doc.body.textContent).toContain('clip 1 of 2');
    expect(p.doc.querySelector('.clipname')?.textContent).toBe('a.mp4');
    expect(p.all('.progress span')).toHaveLength(2);
    expect(p.all('.progress span.cur')).toHaveLength(1);
    expect(p.all('.h')).toHaveLength(3);
    expect(p.doc.body.textContent).toContain('8/10');
  });

  it('thumbs up marks good and selects + plays the next highlight', () => {
    const p = load();
    p.click(`${card(0)} .thumb.up`);
    expect(hl(p, 11).verdicts).toEqual(['good']);
    expect(p.doc.querySelector('.h.sel')?.getAttribute('data-i')).toBe('1');
    expect(p.video().currentTime).toBe(10);
    expect(p.video().paused).toBe(false);
    expect(p.doc.querySelector(card(0))?.classList.contains('good')).toBe(true);
  });

  it('thumbs down reveals reasons; reasons add to verdicts; clicking again clears', () => {
    const p = load();
    p.click(`${card(0)} .thumb.down`);
    expect(hl(p, 11).verdicts).toEqual(['bad']);
    p.click(`${card(0)} .chip[data-r="quality"]`);
    p.click(`${card(0)} .chip[data-r="timing"]`);
    expect(hl(p, 11).verdicts).toEqual(['bad', 'timing', 'quality']);
    p.click(`${card(0)} .chip[data-r="not_highlight"]`);
    expect(hl(p, 11).verdicts).toEqual(['bad', 'not_highlight', 'timing', 'quality']);
    p.click(`${card(0)} .chip[data-r="not_highlight"]`);
    expect(hl(p, 11).verdicts).toEqual(['bad', 'timing', 'quality']);
    p.click(`${card(0)} .thumb.down`);
    expect(hl(p, 11)).toBeUndefined();
  });

  it('keyboard: arrows select, Y/N vote, 1-4 toggle reasons, ignored while typing', () => {
    const p = load();
    p.key('ArrowDown');
    expect(p.doc.querySelector('.h.sel')?.getAttribute('data-i')).toBe('1');
    p.key('n');
    expect(hl(p, 12).verdicts).toEqual(['bad']);
    p.key('1');
    p.key('4');
    expect(hl(p, 12).verdicts).toEqual(['bad', 'not_highlight', 'quality']);
    p.key('ArrowUp');
    p.key('y');
    expect(hl(p, 11).verdicts).toEqual(['good']);
    p.key('1'); // selected is now highlight 12 (auto-advance): bad, toggles reason off
    expect(hl(p, 12).verdicts).toEqual(['bad', 'quality']);

    p.click(`${card(0)} .thumb.down`);
    const input = p.doc.querySelector(`${card(0)} input.note`) as HTMLInputElement;
    p.key('y', input);
    p.key('m', input);
    expect(hl(p, 11).verdicts).toEqual(['bad']);
    expect(p.api.buildExport().missed).toEqual([]);
  });

  it('score thumbs up marks every shown score ok', () => {
    const p = load();
    p.click('#sup');
    const scores = p.api.buildExport().clip_scores.filter((s: any) => s.clip_id === 1);
    expect(scores.map((s: any) => s.score).sort()).toEqual([
      'audio', 'composition', 'emotional', 'exposure', 'focus', 'overall', 'stability', 'storytelling', 'uniqueness',
    ]);
    expect(scores.every((s: any) => s.verdict === 'ok')).toBe(true);
  });

  it('score thumbs down: picking a step marks low/high, untouched stay ok; suggested use toggles', () => {
    const p = load();
    p.click('#sdown');
    // stability is 3: should be 5 -> AI too low; audio is 2: should be 1 -> AI too high
    p.click('.meter[data-k="stability"] i[data-step="5"]');
    p.click('.meter[data-k="audio"] i[data-step="1"]');
    const v = (name: string) => p.api.buildExport().clip_scores.find((s: any) => s.clip_id === 1 && s.score === name)?.verdict;
    expect(v('stability')).toBe('low');
    expect(v('audio')).toBe('high');
    expect(v('focus')).toBe('ok');
    p.click('.tag.use');
    expect(p.api.buildExport().suggested_use_wrong).toEqual([1]);
    p.click('.tag.use');
    expect(p.api.buildExport().suggested_use_wrong).toEqual([]);
    // clicking the active thumb again clears the score vote
    p.click('#sdown');
    expect(p.api.buildExport().clip_scores).toEqual([]);
  });

  it('M adds a missed moment at the playhead; it can get a note and be removed', () => {
    const p = load();
    p.video().currentTime = 7.5;
    p.key('m');
    expect(p.api.buildExport().missed).toEqual([{ clip_id: 1, at_sec: 7.5, note: '' }]);
    const note = p.doc.querySelector('.missed input') as HTMLInputElement;
    note.value = 'person waves';
    note.dispatchEvent(new p.win.Event('input', { bubbles: true }));
    expect(p.api.buildExport().missed[0].note).toBe('person waves');
    p.click('#missbtn');
    expect(p.api.buildExport().missed).toHaveLength(2);
    p.click('.missed [data-rm]');
    expect(p.api.buildExport().missed).toHaveLength(1);
  });

  it('Enter marks the clip done and moves on; zero-highlight clips show an empty state', () => {
    const p = load();
    expect(p.api.buildExport().reviewed_clips).toEqual([]);
    p.key('Enter');
    expect(p.doc.body.textContent).toContain('clip 2 of 2');
    expect(p.doc.body.textContent).toContain('No highlights');
    expect(p.all('.progress span.done')).toHaveLength(1);
    expect(p.api.buildExport().reviewed_clips).toEqual([1]);
    p.key('Enter');
    expect(p.api.buildExport().reviewed_clips).toEqual([1, 2]);
    p.click('#prev');
    expect(p.doc.body.textContent).toContain('clip 1 of 2');
  });

  it('touching a clip (a vote) counts it as reviewed even before it is done', () => {
    const p = load();
    p.key('y');
    expect(p.api.buildExport().reviewed_clips).toEqual([1]);
  });

  it('state survives a reload and the page opens on the first clip not done', () => {
    const p = load();
    p.key('y');
    p.click('#sup');
    p.key('Enter');
    const p2 = load(p.storage());
    expect(Object.keys(p.storage())[0]).toMatch(/^clippilot-review-v2:/);
    expect(p2.doc.body.textContent).toContain('clip 2 of 2');
    const e = p2.api.buildExport();
    expect(e.highlights.find((h: any) => h.highlight_id === 11).verdicts).toEqual(['good']);
    expect(e.reviewed_clips).toEqual([1]);
    expect(e.clip_scores.length).toBeGreaterThan(0);
  });

  it('export has the verdict-schema shape', () => {
    const p = load();
    const e = p.api.buildExport();
    expect(Object.keys(e).sort()).toEqual([
      'clip_notes', 'clip_scores', 'db_generated_at', 'highlights', 'missed', 'project',
      'reviewed_at', 'reviewed_clips', 'suggested_use_wrong',
    ]);
  });
});
