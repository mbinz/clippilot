import { describe, it, expect } from 'vitest';
import { ClipAnalysisResponseSchema, HighlightSchema } from '../../../../src/core/analyze/schema.js';

const VALID_RESPONSE = {
  scenes: [
    {
      start_sec: 0,
      end_sec: 15,
      description_de: 'Kinder spielen am Strand',
      description_en: 'Children playing at the beach',
      subjects: ['Kind 1', 'Kind 2'],
      setting: 'Strand',
      activity: 'Spielen',
      mood: 'fröhlich',
      visual_keywords: ['Strand', 'Kinder', 'Sand'],
    },
  ],
  clip_summary: 'Schöner Strandmoment mit spielenden Kindern',
};

describe('ClipAnalysisResponseSchema', () => {
  it('validates a correct response', () => {
    const result = ClipAnalysisResponseSchema.parse(VALID_RESPONSE);
    expect(result.scenes).toHaveLength(1);
    expect(result.clip_summary).toMatch(/Strand/);
  });

  it('no longer requires or returns clip scores (old responses still parse, scores are stripped)', () => {
    const old = {
      ...VALID_RESPONSE,
      technical_quality: { stability: 4, focus: 5, exposure: 4, composition: 3, audio_quality: 2, overall_score: 3.6, issues: [] },
      editorial_value: { emotional_impact: 4, storytelling_potential: 3, uniqueness: 2, suggested_use: 'B-Roll' },
    };
    const result = ClipAnalysisResponseSchema.parse(old) as Record<string, unknown>;
    expect(result.technical_quality).toBeUndefined();
    expect(result.editorial_value).toBeUndefined();
  });

  it('rejects missing required fields', () => {
    expect(() => ClipAnalysisResponseSchema.parse({})).toThrow();
  });

  it('rejects missing scenes array', () => {
    const { scenes, ...noScenes } = VALID_RESPONSE;
    expect(() => ClipAnalysisResponseSchema.parse(noScenes)).toThrow();
  });

  it('accepts multiple scenes', () => {
    const multiScene = {
      ...VALID_RESPONSE,
      scenes: [
        VALID_RESPONSE.scenes[0],
        {
          ...VALID_RESPONSE.scenes[0],
          start_sec: 15,
          end_sec: 30,
          description_de: 'Zweite Szene',
          description_en: 'Second scene',
        },
      ],
    };
    const result = ClipAnalysisResponseSchema.parse(multiScene);
    expect(result.scenes).toHaveLength(2);
  });
});

const MOMENT = { start_sec: 2.5, end_sec: 6, description: 'Wave crashes on rocks', tier: 'hero', shot: 'wide', role: 'action' };

describe('ClipAnalysisResponseSchema highlights', () => {
  it('parses a response with highlights and defaults issues/slowmo', () => {
    const result = ClipAnalysisResponseSchema.parse({ ...VALID_RESPONSE, highlights: [MOMENT] });
    expect(result.highlights).toEqual([{ ...MOMENT, issues: [], slowmo: 'none', slowmo_reason: '' }]);
  });

  it('defaults highlights to [] when missing', () => {
    expect(ClipAnalysisResponseSchema.parse(VALID_RESPONSE).highlights).toEqual([]);
  });

  it('rejects the old numeric quality without tier', () => {
    const { tier, shot, role, ...rest } = MOMENT;
    expect(() => HighlightSchema.parse({ ...rest, quality: 8 })).toThrow();
  });
});

describe('HighlightSchema tags', () => {
  it('accepts every tier, shot, role and issue value', () => {
    for (const tier of ['hero', 'solid', 'filler']) expect(HighlightSchema.parse({ ...MOMENT, tier }).tier).toBe(tier);
    for (const shot of ['wide', 'medium', 'close', 'detail']) expect(HighlightSchema.parse({ ...MOMENT, shot }).shot).toBe(shot);
    for (const role of ['establishing', 'action', 'reaction', 'detail', 'transition']) {
      expect(HighlightSchema.parse({ ...MOMENT, role }).role).toBe(role);
    }
    const issues = ['shake', 'blur', 'obstructed', 'overexposed', 'underexposed'];
    expect(HighlightSchema.parse({ ...MOMENT, issues }).issues).toEqual(issues);
  });

  it('rejects unknown tier, shot, role and issue values', () => {
    expect(() => HighlightSchema.parse({ ...MOMENT, tier: 'epic' })).toThrow();
    expect(() => HighlightSchema.parse({ ...MOMENT, shot: 'macro' })).toThrow();
    expect(() => HighlightSchema.parse({ ...MOMENT, role: 'intro' })).toThrow();
    expect(() => HighlightSchema.parse({ ...MOMENT, issues: ['noisy'] })).toThrow();
  });

  it('requires tier, shot and role', () => {
    for (const key of ['tier', 'shot', 'role']) {
      const { [key]: _omit, ...rest } = MOMENT as Record<string, unknown>;
      expect(() => HighlightSchema.parse(rest)).toThrow();
    }
  });
});

describe('HighlightSchema slowmo', () => {
  it('defaults slowmo to none and reason to empty for old responses', () => {
    const h = HighlightSchema.parse(MOMENT);
    expect(h.slowmo).toBe('none');
    expect(h.slowmo_reason).toBe('');
  });
  it('accepts light/strong and rejects other values', () => {
    expect(HighlightSchema.parse({ ...MOMENT, slowmo: 'strong', slowmo_reason: 'waves' }).slowmo).toBe('strong');
    expect(() => HighlightSchema.parse({ ...MOMENT, slowmo: 'extreme' })).toThrow();
  });
});
