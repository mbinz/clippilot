import { describe, it, expect } from 'vitest';
import { proxyArgs } from '../../../../src/core/ingest/proxy.js';

describe('proxyArgs', () => {
  const args = proxyArgs('/in/a.MP4', '/out/a.mp4', 720);
  const after = (flag: string) => args[args.indexOf(flag) + 1];

  it('forces 8-bit 4:2:0 High profile for browser hardware decode', () => {
    expect(after('-pix_fmt')).toBe('yuv420p');
    expect(after('-profile:v')).toBe('high');
  });

  it('puts a keyframe every second regardless of source fps', () => {
    expect(after('-force_key_frames')).toBe('expr:gte(t,n_forced*1)');
    expect(after('-sc_threshold')).toBe('0');
  });

  it('keeps scale, faststart and audio settings', () => {
    expect(after('-vf')).toBe('scale=-2:720');
    expect(after('-movflags')).toBe('+faststart');
    expect(after('-c:a')).toBe('aac');
    expect(after('-preset')).toBe('fast');
  });

  it('has input after -i and output last', () => {
    expect(after('-i')).toBe('/in/a.MP4');
    expect(args[args.length - 1]).toBe('/out/a.mp4');
  });

  it('honours the resolution', () => {
    const a = proxyArgs('a', 'b', 480);
    expect(a[a.indexOf('-vf') + 1]).toBe('scale=-2:480');
  });
});
