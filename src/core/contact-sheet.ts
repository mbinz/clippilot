import sharp from 'sharp';

export interface ContactSheetCell {
  clip_id: number;
  thumbnail_path: string;
  label: string;
}

export interface ContactSheetOptions {
  cols?: number;
  rows?: number;
  cellWidth?: number;
  cellHeight?: number;
  padding?: number;
  labelHeight?: number;
  background?: string;
}

export interface ContactSheetCellPlacement {
  position: number;
  clip_id: number;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ContactSheetLayout {
  cols: number;
  rows: number;
  canvas_width: number;
  canvas_height: number;
  cells: ContactSheetCellPlacement[];
}

export const DEFAULT_OPTIONS: Required<ContactSheetOptions> = {
  cols: 4,
  rows: 6,
  cellWidth: 320,
  cellHeight: 180,
  padding: 8,
  labelHeight: 24,
  background: '#1a1a1a',
};

export function layoutContactSheet(
  cells: ContactSheetCell[],
  options: ContactSheetOptions = {},
): ContactSheetLayout {
  const o = { ...DEFAULT_OPTIONS, ...options };
  const tileW = o.cellWidth;
  const tileH = o.cellHeight + o.labelHeight;
  const used = cells.slice(0, o.cols * o.rows);

  const placements: ContactSheetCellPlacement[] = used.map((cell, i) => {
    const col = i % o.cols;
    const row = Math.floor(i / o.cols);
    return {
      position: i,
      clip_id: cell.clip_id,
      label: cell.label,
      x: o.padding + col * (tileW + o.padding),
      y: o.padding + row * (tileH + o.padding),
      width: tileW,
      height: tileH,
    };
  });

  return {
    cols: o.cols,
    rows: o.rows,
    canvas_width: o.cols * tileW + (o.cols + 1) * o.padding,
    canvas_height: o.rows * tileH + (o.rows + 1) * o.padding,
    cells: placements,
  };
}

export async function renderContactSheet(
  cells: ContactSheetCell[],
  outPath: string,
  options: ContactSheetOptions = {},
): Promise<ContactSheetLayout> {
  const o = { ...DEFAULT_OPTIONS, ...options };
  const layout = layoutContactSheet(cells, options);
  const composites: sharp.OverlayOptions[] = [];

  for (let i = 0; i < layout.cells.length; i++) {
    const cell = layout.cells[i];
    const source = cells[i];

    const thumb = await sharp(source.thumbnail_path)
      .resize(o.cellWidth, o.cellHeight, { fit: 'cover', position: 'centre' })
      .toBuffer();
    composites.push({ input: thumb, left: cell.x, top: cell.y });

    const labelSvg = Buffer.from(
      `<svg width="${o.cellWidth}" height="${o.labelHeight}" xmlns="http://www.w3.org/2000/svg">` +
        `<rect width="${o.cellWidth}" height="${o.labelHeight}" fill="black" fill-opacity="0.75"/>` +
        `<text x="6" y="${o.labelHeight - 7}" font-family="monospace" font-size="14" fill="white">${escapeXml(source.label)}</text>` +
        `</svg>`,
    );
    composites.push({
      input: labelSvg,
      left: cell.x,
      top: cell.y + o.cellHeight,
    });
  }

  await sharp({
    create: {
      width: layout.canvas_width,
      height: layout.canvas_height,
      channels: 3,
      background: o.background,
    },
  })
    .composite(composites)
    .png()
    .toFile(outPath);

  return layout;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
