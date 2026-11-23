import { describe, it, expect } from 'vitest';
import { shouldRefetch, updateLabel, selectionKey, type Head } from '../../../web/src/board/refresh.js';

const head = (o: Partial<Head> = {}): Head => ({
  op_id: 5, can_undo: true, can_redo: false, undo_label: 'Trim moment', redo_label: null, ...o,
});

describe('shouldRefetch(prev, next, own)', () => {
  it('first observation (no baseline) never refetches', () => {
    expect(shouldRefetch(null, head(), null)).toBe(false);
  });
  it('no change -> no refetch', () => {
    expect(shouldRefetch(head(), head(), null)).toBe(false);
  });
  it('new operation from elsewhere -> refetch', () => {
    expect(shouldRefetch(head(), head({ op_id: 6, undo_label: 'Speed 50 %' }), null)).toBe(true);
  });
  it('undo / redo from elsewhere (same op id, state flipped) -> refetch', () => {
    expect(shouldRefetch(head(), head({ can_undo: false, can_redo: true, undo_label: null, redo_label: 'Trim moment' }), null)).toBe(true);
    expect(shouldRefetch(head({ can_undo: false, can_redo: true, redo_label: 'Trim moment', undo_label: null }), head(), null)).toBe(true);
  });
  it('a change that equals this tab\'s own last head is not a refetch', () => {
    const own = head({ op_id: 6, undo_label: 'Speed 50 %' });
    expect(shouldRefetch(head(), own, own)).toBe(false);
  });
  it('own head is stale (someone edited after it) -> refetch', () => {
    const own = head({ op_id: 6, undo_label: 'Speed 50 %' });
    expect(shouldRefetch(own, head({ op_id: 7, undo_label: 'Trim moment' }), own)).toBe(true);
  });
  it('no operations at all stays quiet', () => {
    const empty = head({ op_id: null, can_undo: false, undo_label: null });
    expect(shouldRefetch(empty, { ...empty }, null)).toBe(false);
    expect(shouldRefetch(empty, head(), null)).toBe(true);
  });
});

describe('updateLabel(prev, next)', () => {
  it('new op -> its label', () => {
    expect(updateLabel(head(), head({ op_id: 6, undo_label: 'Speed 50 %' }))).toBe('Speed 50 %');
  });
  it('undo -> "Undo <label>", redo -> "Redo <label>"', () => {
    expect(updateLabel(head(), head({ can_undo: false, can_redo: true, undo_label: null, redo_label: 'Trim moment' }))).toBe('Undo Trim moment');
    expect(updateLabel(head({ can_undo: false, can_redo: true, undo_label: null, redo_label: 'Trim moment' }), head())).toBe('Redo Trim moment');
  });
  it('falls back to a generic label', () => {
    expect(updateLabel(null, head({ undo_label: null, op_id: 9 }))).toBe('board');
  });
});

describe('selectionKey', () => {
  it('equal selections give equal keys, any field change gives a new key', () => {
    const a = { cut_id: 1, scene_id: 2, panel_id: null, moment_id: null, drawer: null, preview_moment_id: null } as const;
    expect(selectionKey(a)).toBe(selectionKey({ ...a }));
    expect(selectionKey(a)).not.toBe(selectionKey({ ...a, drawer: 'panel' }));
    expect(selectionKey(a)).not.toBe(selectionKey({ ...a, preview_moment_id: 3 }));
  });
});
