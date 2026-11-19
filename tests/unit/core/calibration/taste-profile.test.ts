import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadTasteProfile } from '../../../../src/core/calibration/taste-profile.js';
import { buildUserPrompt, USER_PROMPT } from '../../../../src/core/analyze/prompts.js';

describe('loadTasteProfile', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'taste-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('returns null when no profile exists', () => {
    expect(loadTasteProfile(dir)).toBeNull();
  });

  it('returns null when the directory does not exist', () => {
    expect(loadTasteProfile(path.join(dir, 'nope'))).toBeNull();
  });

  it('treats plain taste-profile.md as version 1', () => {
    writeFileSync(path.join(dir, 'taste-profile.md'), 'Mehr Gesichter.\n');
    expect(loadTasteProfile(dir)).toEqual({ version: 1, text: 'Mehr Gesichter.' });
  });

  it('picks the highest numbered version, numerically (v10 over v2)', () => {
    writeFileSync(path.join(dir, 'taste-profile.md'), 'current');
    writeFileSync(path.join(dir, 'taste-profile.v2.md'), 'two');
    writeFileSync(path.join(dir, 'taste-profile.v10.md'), 'ten');
    writeFileSync(path.join(dir, 'taste-profile.v3.md'), 'three');
    expect(loadTasteProfile(dir)).toEqual({ version: 10, text: 'ten' });
  });
});

describe('buildUserPrompt', () => {
  it('returns USER_PROMPT unchanged without a profile', () => {
    expect(buildUserPrompt(null)).toBe(USER_PROMPT);
  });

  it('appends the profile text in a labelled section', () => {
    const out = buildUserPrompt({ version: 2, text: 'Keine wackeligen Schwenks.' });
    expect(out.startsWith(USER_PROMPT)).toBe(true);
    expect(out).toContain('Vorlieben dieses Editors (befolgen):\nKeine wackeligen Schwenks.');
  });
});
