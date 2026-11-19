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
      fps: 50,
      highlights: [
        { highlight_id: 11, start_sec: 3, end_sec: 5, description: 'first', tier: 'hero', shot: 'wide', role: 'establishing', issues: [], slowmo: 'none', slowmo_reason: '', suggested_speed: 1 },
        { highlight_id: 12, start_sec: 10, end_sec: 12, description: 'second', tier: 'solid', shot: 'close', role: 'action', issues: ['shake', 'blur'], slowmo: 'light', slowmo_reason: 'waves rolling in', suggested_speed: 0.5 },
        { highlight_id: 13, start_sec: 20, end_sec: 22, description: 'third', tier: 'filler', shot: 'detail', role: 'transition', issues: [], slowmo: 'strong', slowmo_reason: 'big splash', suggested_speed: 0.25 },
      ],
    },
    {
      clip_id: 2, file_name: 'b.mp4', file_path: '/v/b.mp4', scene_hint: 'A', duration_sec: 20,
      proxy_url: 'file:///p/b.mp4', ai_summary: 'empty', places: [], moments: [],
      fps: null,
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

  it('keyboard: arrows select, Y/N vote, 1-5 toggle reasons, ignored while typing', () => {
    const p = load();
    p.key('ArrowDown');
    expect(p.doc.querySelector('.h.sel')?.getAttribute('data-i')).toBe('1');
    p.key('n');
    expect(hl(p, 12).verdicts).toEqual(['bad']);
    p.key('1');
    p.key('4');
    p.key('5');
    expect(hl(p, 12).verdicts).toEqual(['bad', 'not_highlight', 'quality', 'speed']);
    p.key('ArrowUp');
    p.key('y');
    expect(hl(p, 11).verdicts).toEqual(['good']);
    p.key('1'); // selected is now highlight 12 (auto-advance): bad, toggles reason off
    expect(hl(p, 12).verdicts).toEqual(['bad', 'quality', 'speed']);

    p.click(`${card(0)} .thumb.down`);
    const input = p.doc.querySelector(`${card(0)} input.note`) as HTMLInputElement;
    p.key('y', input);
    p.key('m', input);
    expect(hl(p, 11).verdicts).toEqual(['bad']);
    expect(p.api.buildExport().missed).toEqual([]);
  });

  it('has no score UI at all and exports no clip score verdicts', () => {
    const p = load();
    expect(p.doc.querySelector('#sup')).toBeNull();
    expect(p.doc.querySelector('#sdown')).toBeNull();
    expect(p.doc.querySelector('.scorevote')).toBeNull();
    expect(p.doc.body.textContent).not.toContain('Scores look right');
    expect(p.all('.meter')).toHaveLength(0);
    expect(p.all('.ring')).toHaveLength(0);
    expect(p.all('.bars')).toHaveLength(0);
    expect(p.all('.qdots')).toHaveLength(0);
    expect(p.doc.body.textContent).not.toMatch(/\/10/);
    expect(p.doc.body.textContent).not.toContain('Suggested:');
    p.key('y');
    const e = p.api.buildExport();
    expect(e.clip_scores).toEqual([]);
    expect(e.suggested_use_wrong).toEqual([]);
  });

  it('clip card is one line (file · folder · duration · fps) plus the summary', () => {
    const p = load();
    expect(p.doc.querySelector('.clipname')?.textContent).toBe('a.mp4');
    expect(p.doc.querySelector('.clipmeta')?.textContent).toBe('A · 0:30 · 50 fps');
    expect(p.doc.querySelector('.summary')?.textContent).toBe('boat trip');
    p.key('Enter');
    expect(p.doc.querySelector('.clipmeta')?.textContent).toBe('A · 0:20');
  });

  it('highlight card shows tier pill, shot · role and issue tags', () => {
    const p = load();
    expect(p.doc.querySelector(`${card(0)} .tier`)?.textContent).toBe('hero');
    expect(p.doc.querySelector(`${card(0)} .tier`)?.classList.contains('hero')).toBe(true);
    expect(p.doc.querySelector(`${card(1)} .tier`)?.textContent).toBe('solid');
    expect(p.doc.querySelector(`${card(2)} .tier`)?.textContent).toBe('filler');
    expect(p.doc.querySelector(`${card(0)} .shotrole`)?.textContent).toBe('wide · establishing');
    expect(p.doc.querySelector(`${card(2)} .shotrole`)?.textContent).toBe('detail · transition');
    expect(p.all(`${card(0)} .issue`)).toHaveLength(0);
    expect(p.all(`${card(1)} .issue`).map((e) => e.textContent)).toEqual(['shake', 'blur']);
  });

  it('shows a slow-mo badge with reason only when suggested_speed < 1', () => {
    const p = load();
    expect(p.doc.querySelector(`${card(0)} .slowmo`)).toBeNull();
    expect(p.doc.querySelector(`${card(0)} .spd`)).toBeNull();
    expect(p.doc.querySelector(`${card(1)} .slowmo`)?.textContent).toContain('50 %');
    expect(p.doc.querySelector(`${card(1)} .slowmo`)?.textContent).toContain('🐢');
    expect(p.doc.querySelector(`${card(1)}`)?.textContent).toContain('waves rolling in');
    expect(p.doc.querySelector(`${card(2)} .slowmo`)?.textContent).toContain('25 %');
  });

  it('playing a slow-mo highlight uses its suggested rate; S toggles to 1x and back; normal highlights play at 1', () => {
    const p = load();
    p.click(card(1));
    expect(p.video().playbackRate).toBe(0.5);
    p.key('s');
    expect(p.video().playbackRate).toBe(1);
    p.key('s');
    expect(p.video().playbackRate).toBe(0.5);
    p.click(`${card(1)} .spd`);
    expect(p.video().playbackRate).toBe(1);
    p.click(card(2));
    expect(p.video().playbackRate).toBe(0.25);
    p.click(card(0));
    expect(p.video().playbackRate).toBe(1);
    p.key('s'); // nothing to toggle on a normal-speed highlight
    expect(p.video().playbackRate).toBe(1);
  });

  it('thumbs up on a highlight auto-advances into the next one at its suggested rate', () => {
    const p = load();
    p.click(`${card(0)} .thumb.up`);
    expect(p.video().playbackRate).toBe(0.5);
  });

  it('reason chip 5 "Speed wrong" is always offered and exports as bad + speed', () => {
    const p = load();
    p.click(`${card(0)} .thumb.down`);
    expect(p.doc.querySelector(`${card(0)} .chip[data-r="speed"]`)?.textContent).toContain('Speed wrong');
    p.key('5');
    expect(hl(p, 11).verdicts).toEqual(['bad', 'speed']);
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
    p.key('Enter');
    const p2 = load(p.storage());
    expect(Object.keys(p.storage())[0]).toMatch(/^clippilot-review-v2:/);
    expect(p2.doc.body.textContent).toContain('clip 2 of 2');
    const e = p2.api.buildExport();
    expect(e.highlights.find((h: any) => h.highlight_id === 11).verdicts).toEqual(['good']);
    expect(e.reviewed_clips).toEqual([1]);
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
