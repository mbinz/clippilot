/**
 * Convert seconds to SMPTE timecode (HH:MM:SS:FF)
 */
export function secondsToTimecode(totalSeconds: number, fps: number = 30): string {
  const frames = Math.round(totalSeconds * fps);
  const ff = frames % fps;
  const totalSec = Math.floor(frames / fps);
  const ss = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const mm = totalMin % 60;
  const hh = Math.floor(totalMin / 60);

  return [
    String(hh).padStart(2, '0'),
    String(mm).padStart(2, '0'),
    String(ss).padStart(2, '0'),
    String(ff).padStart(2, '0'),
  ].join(':');
}

/**
 * Convert SMPTE timecode (HH:MM:SS:FF) to seconds
 */
export function timecodeToSeconds(timecode: string, fps: number = 30): number {
  const parts = timecode.split(':');
  if (parts.length !== 4) {
    throw new Error(`Invalid timecode format: ${timecode}. Expected HH:MM:SS:FF`);
  }

  const [hh, mm, ss, ff] = parts.map(Number);

  if ([hh, mm, ss, ff].some(isNaN)) {
    throw new Error(`Invalid timecode values: ${timecode}`);
  }

  const totalFrames = ((hh * 3600) + (mm * 60) + ss) * fps + ff;
  return totalFrames / fps;
}

/**
 * Format seconds as human-readable duration (e.g., "1:23:45" or "2:30")
 */
export function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
