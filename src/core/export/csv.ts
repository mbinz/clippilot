import type { ExportSegment, ExportOptions } from '../../types/export.js';

export function exportCsv(segments: ExportSegment[], _options: ExportOptions): string {
  const header = 'position,clip_id,file_path,file_name,start_sec,end_sec,duration_sec,quality,role,summary';
  const rows = segments.map((seg) => {
    const fields = [
      seg.position,
      seg.clip_id,
      csvEscape(seg.file_path),
      csvEscape(seg.file_name),
      seg.start_sec.toFixed(2),
      seg.end_sec.toFixed(2),
      (seg.end_sec - seg.start_sec).toFixed(2),
      seg.ai_quality_overall?.toFixed(1) ?? '',
      seg.segment_role ?? '',
      csvEscape(seg.ai_summary ?? ''),
    ];
    return fields.join(',');
  });

  return [header, ...rows].join('\n');
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
