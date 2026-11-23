import { speedAllowed } from '../analyze/highlights.js';

/**
 * Speed a moment starts with: its suggested speed when the clip's frame rate allows it, else 1.
 * (A moment plays whole; there is no default window any more - trimming is the user's edit.)
 */
export function defaultSpeed(suggestedSpeed: number, fps: number | null | undefined): number {
  return speedAllowed(suggestedSpeed, fps) ? suggestedSpeed : 1;
}
