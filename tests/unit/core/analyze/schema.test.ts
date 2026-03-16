import { describe, it, expect } from 'vitest';
import { ClipAnalysisResponseSchema } from '../../../../src/core/analyze/schema.js';

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
  technical_quality: {
    stability: 4,
    focus: 5,
    exposure: 4,
    composition: 3,
    audio_quality: 2,
    overall_score: 3.6,
    issues: ['leichter Wind auf Mikrofon'],
  },
  editorial_value: {
    emotional_impact: 4,
    storytelling_potential: 3,
    uniqueness: 2,
    suggested_use: 'B-Roll',
  },
  clip_summary: 'Schöner Strandmoment mit spielenden Kindern',
};

describe('ClipAnalysisResponseSchema', () => {
  it('validates a correct response', () => {
    const result = ClipAnalysisResponseSchema.parse(VALID_RESPONSE);
    expect(result.scenes).toHaveLength(1);
    expect(result.technical_quality.stability).toBe(4);
    expect(result.editorial_value.suggested_use).toBe('B-Roll');
  });

  it('rejects quality scores out of range', () => {
    const invalid = {
      ...VALID_RESPONSE,
      technical_quality: { ...VALID_RESPONSE.technical_quality, stability: 6 },
    };
    expect(() => ClipAnalysisResponseSchema.parse(invalid)).toThrow();
  });

  it('rejects quality scores below minimum', () => {
    const invalid = {
      ...VALID_RESPONSE,
      technical_quality: { ...VALID_RESPONSE.technical_quality, focus: 0 },
    };
    expect(() => ClipAnalysisResponseSchema.parse(invalid)).toThrow();
  });

  it('rejects invalid suggested_use', () => {
    const invalid = {
      ...VALID_RESPONSE,
      editorial_value: { ...VALID_RESPONSE.editorial_value, suggested_use: 'InvalidType' },
    };
    expect(() => ClipAnalysisResponseSchema.parse(invalid)).toThrow();
  });

  it('rejects missing required fields', () => {
    expect(() => ClipAnalysisResponseSchema.parse({})).toThrow();
  });

  it('rejects missing scenes array', () => {
    const { scenes, ...noScenes } = VALID_RESPONSE;
    expect(() => ClipAnalysisResponseSchema.parse(noScenes)).toThrow();
  });

  it('accepts all valid suggested_use values', () => {
    for (const use of ['Hero Shot', 'B-Roll', 'Establishing', 'Transition', 'Skip']) {
      const data = {
        ...VALID_RESPONSE,
        editorial_value: { ...VALID_RESPONSE.editorial_value, suggested_use: use },
      };
      const result = ClipAnalysisResponseSchema.parse(data);
      expect(result.editorial_value.suggested_use).toBe(use);
    }
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
