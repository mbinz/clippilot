import { describe, it, expect } from 'vitest';
import {
  layoutContactSheet,
  DEFAULT_OPTIONS,
} from '../../../src/core/contact-sheet.js';

function cells(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    clip_id: i + 1,
    thumbnail_path: `/t/${i}.jpg`,
    label: `clip ${i + 1}`,
  }));
}

describe('layoutContactSheet', () => {
  it('places cells in row-major order', () => {
    const layout = layoutContactSheet(cells(8), { cols: 4, rows: 2 });
    expect(layout.cells).toHaveLength(8);
    expect(layout.cells[0].position).toBe(0);
    expect(layout.cells[4].position).toBe(4);
    expect(layout.cells[0].y).toBe(layout.cells[3].y);
    expect(layout.cells[4].y).toBeGreaterThan(layout.cells[0].y);
    expect(layout.cells[0].x).toBeLessThan(layout.cells[1].x);
  });

  it('truncates to cols * rows cells', () => {
    const layout = layoutContactSheet(cells(50), { cols: 4, rows: 6 });
    expect(layout.cells).toHaveLength(24);
    expect(layout.cells[23].clip_id).toBe(24);
  });

  it('preserves clip_id and label per cell', () => {
    const layout = layoutContactSheet(cells(4), { cols: 2, rows: 2 });
    expect(layout.cells.map((c) => c.clip_id)).toEqual([1, 2, 3, 4]);
    expect(layout.cells.map((c) => c.label)).toEqual([
      'clip 1',
      'clip 2',
      'clip 3',
      'clip 4',
    ]);
  });

  it('canvas grows with cell + padding count', () => {
    const layout = layoutContactSheet(cells(24), {
      cols: 4,
      rows: 6,
      cellWidth: 100,
      cellHeight: 50,
      padding: 10,
      labelHeight: 20,
    });
    // 4 cells of 100 wide + 5 paddings of 10 = 450
    expect(layout.canvas_width).toBe(4 * 100 + 5 * 10);
    // 6 cells of (50+20) tall + 7 paddings of 10 = 490
    expect(layout.canvas_height).toBe(6 * 70 + 7 * 10);
  });

  it('uses default options when none provided', () => {
    const layout = layoutContactSheet(cells(1));
    expect(layout.cols).toBe(DEFAULT_OPTIONS.cols);
    expect(layout.rows).toBe(DEFAULT_OPTIONS.rows);
  });

  it('handles fewer cells than the grid', () => {
    const layout = layoutContactSheet(cells(3), { cols: 4, rows: 6 });
    expect(layout.cells).toHaveLength(3);
    // Canvas is still full grid size — fixed layout
    expect(layout.canvas_width).toBeGreaterThan(0);
    expect(layout.canvas_height).toBeGreaterThan(0);
  });
});
