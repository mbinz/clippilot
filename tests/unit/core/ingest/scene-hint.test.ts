import { describe, it, expect } from 'vitest';
import { sceneHintFor } from '../../../../src/core/ingest/scene-hint.js';

describe('sceneHintFor', () => {
  it('uses the relative parent directory with / separators', () => {
    expect(sceneHintFor('/v/Import', '/v/Import/03 Arrifana/Delfine/C0560.MP4')).toBe('03 Arrifana/Delfine');
  });

  it('uses the root basename for files directly in the root', () => {
    expect(sceneHintFor('/v/Delfine', '/v/Delfine/C0560.MP4')).toBe('Delfine');
  });

  it('handles three nested levels', () => {
    expect(sceneHintFor('/v/Import', '/v/Import/a/b/c/clip.mp4')).toBe('a/b/c');
  });

  it('keeps trailing spaces in segments verbatim', () => {
    expect(sceneHintFor('/x/Src /Import', '/x/Src /Import/01 Flug/a.mp4')).toBe('01 Flug');
    expect(sceneHintFor('/x/Import', '/x/Import/01 Flug /a.mp4')).toBe('01 Flug ');
  });
});
