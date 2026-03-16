import { describe, it, expect } from 'vitest';
import { isVideoFile } from '../../../src/utils/fs.js';

describe('isVideoFile', () => {
  it('recognizes .mp4', () => {
    expect(isVideoFile('video.mp4')).toBe(true);
  });

  it('recognizes .mov', () => {
    expect(isVideoFile('/path/to/video.mov')).toBe(true);
  });

  it('recognizes .avi', () => {
    expect(isVideoFile('clip.avi')).toBe(true);
  });

  it('recognizes .mkv', () => {
    expect(isVideoFile('clip.mkv')).toBe(true);
  });

  it('recognizes .mts', () => {
    expect(isVideoFile('00001.mts')).toBe(true);
  });

  it('recognizes .m4v', () => {
    expect(isVideoFile('clip.m4v')).toBe(true);
  });

  it('recognizes .webm', () => {
    expect(isVideoFile('clip.webm')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isVideoFile('clip.MP4')).toBe(true);
    expect(isVideoFile('clip.MOV')).toBe(true);
  });

  it('rejects non-video files', () => {
    expect(isVideoFile('image.jpg')).toBe(false);
    expect(isVideoFile('document.pdf')).toBe(false);
    expect(isVideoFile('music.mp3')).toBe(false);
    expect(isVideoFile('readme.txt')).toBe(false);
  });

  it('rejects files with no extension', () => {
    expect(isVideoFile('noextension')).toBe(false);
  });
});
