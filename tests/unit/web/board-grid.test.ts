import { describe, it, expect } from 'vitest';
import { moveTarget, dragKind, PANEL_MIME, GHOST_MIME } from '../../../web/src/board/grid.js';

describe('moveTarget (position to send when a panel is dropped on insert slot i)', () => {
  const ids = [10, 11, 12, 13];
  it('moving forward subtracts one for the removed panel', () => {
    expect(moveTarget(ids, 10, 3)).toBe(2);
    expect(moveTarget(ids, 11, 4)).toBe(3);
  });
  it('moving backward keeps the slot index', () => {
    expect(moveTarget(ids, 13, 1)).toBe(1);
    expect(moveTarget(ids, 12, 0)).toBe(0);
  });
  it('the slots right before and after the dragged panel are a no-op', () => {
    expect(moveTarget(ids, 11, 1)).toBeNull();
    expect(moveTarget(ids, 11, 2)).toBeNull();
    expect(moveTarget(ids, 10, 0)).toBeNull();
    expect(moveTarget(ids, 13, 4)).toBeNull();
  });
  it('first and last slot work', () => {
    expect(moveTarget(ids, 12, 0)).toBe(0);
    expect(moveTarget(ids, 11, 4)).toBe(3);
  });
  it('unknown panel (other scene) -> slot index unchanged', () => {
    expect(moveTarget(ids, 99, 2)).toBe(2);
  });
});

describe('dragKind (from DataTransfer.types)', () => {
  it('panel payload wins', () => {
    expect(dragKind([PANEL_MIME, 'text/plain'])).toBe('panel');
  });
  it('plain text = moment id', () => {
    expect(dragKind(['text/plain'])).toBe('moment');
  });
  it('the placement ghost has its own payload (BE3); it wins over plain text', () => {
    expect(dragKind([GHOST_MIME, 'text/plain'])).toBe('ghost');
  });
  it('anything else = null', () => {
    expect(dragKind([])).toBeNull();
    expect(dragKind(['Files'])).toBeNull();
  });
});
