import { describe, it, expect } from 'vitest';
import { resolveCut, cutParam, searchWithCut } from '../../../web/src/board/cuts.js';

const cuts = [{ id: 3, project_id: 1, name: 'Draft' }, { id: 5, project_id: 1, name: 'Main' }];

describe('cutParam', () => {
  it('parses a positive id', () => expect(cutParam('?cut=7')).toBe(7));
  it('ignores junk, empty, negative, zero', () => {
    for (const s of ['', '?cut=', '?cut=abc', '?cut=-2', '?cut=0', '?x=1']) expect(cutParam(s)).toBeNull();
  });
});

describe('resolveCut', () => {
  it('valid param wins', () => expect(resolveCut(cuts, 3)?.name).toBe('Draft'));
  it('no param -> Main', () => expect(resolveCut(cuts, null)?.id).toBe(5));
  it('unknown id -> Main', () => expect(resolveCut(cuts, 99)?.id).toBe(5));
  it('no Main, no param -> null (caller creates Main)', () => expect(resolveCut([cuts[0]!], null)).toBeNull());
  it('valid param works without Main', () => expect(resolveCut([cuts[0]!], 3)?.id).toBe(3));
});

describe('searchWithCut', () => {
  it('sets the param, keeping others', () => expect(searchWithCut('?a=1', 3, 5)).toBe('?a=1&cut=3'));
  it('replaces an existing one', () => expect(searchWithCut('?cut=3', 4, 5)).toBe('?cut=4'));
  it('drops it for Main', () => expect(searchWithCut('?a=1&cut=3', 5, 5)).toBe('?a=1'));
  it('empty result is an empty string', () => expect(searchWithCut('?cut=3', 5, 5)).toBe(''));
});
