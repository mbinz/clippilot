import type { ExportSegment, ExportOptions, ExportFormat } from '../../types/export.js';
import { exportCsv } from './csv.js';
import { exportJson } from './json.js';
import { exportEdl } from './edl.js';
import { exportFcpxml } from './fcpxml.js';

const exporters: Record<ExportFormat, (segments: ExportSegment[], options: ExportOptions) => string> = {
  csv: exportCsv,
  json: exportJson,
  edl: exportEdl,
  fcpxml: exportFcpxml,
};

export function exportSegments(
  segments: ExportSegment[],
  options: Omit<ExportOptions, 'output'>,
): string {
  const exporter = exporters[options.format];
  if (!exporter) {
    throw new Error(`Unsupported export format: ${options.format}`);
  }
  return exporter(segments, options as ExportOptions);
}
