import { describe, it, expect, beforeEach } from 'vitest';
import { setup } from './_helpers.js';
import { TranscriptRepository } from '../../../../src/db/repositories/transcript.repository.js';

describe('moments carry their speech', () => {
  let t: ReturnType<typeof setup>;
  let clipId: number;
  let withSpeech: number;
  let without: number;

  beforeEach(() => {
    t = setup();
    clipId = t.addClip().id;
    [withSpeech, without] = t.addMoments(clipId, [{ start_sec: 3, end_sec: 8 }, { start_sec: 20, end_sec: 24 }]);
    new TranscriptRepository(t.db).save(clipId, 'm', {
      language: 'de',
      segments: [{ start: 2, end: 6, text: 'Schau mal die Delfine.' }],
      words: [
        { start: 2, end: 3, text: 'Schau', p: 1 }, { start: 3, end: 3.5, text: 'mal', p: 1 },
        { start: 3.5, end: 4.5, text: 'die', p: 1 }, { start: 4.5, end: 6, text: 'Delfine.', p: 1 },
      ],
    });
  });

  it('moments list rows have speech and speech_cut', () => {
    const rows = t.svc.listMoments(t.projectId);
    expect(rows.find((r) => r.id === withSpeech)).toMatchObject({ speech: 'mal die Delfine.', speech_cut: 'start' });
    expect(rows.find((r) => r.id === without)).toMatchObject({ speech: '', speech_cut: null });
  });

  it('clips without a transcript have speech null', () => {
    const other = t.addClip().id;
    const [m] = t.addMoments(other, [{}]);
    expect(t.svc.listMoments(t.projectId).find((r) => r.id === m)).toMatchObject({ speech: null, speech_cut: null });
  });

  it('cut show: the panel moment and its candidates carry speech and speech_cut', () => {
    const cut = t.svc.createCut(t.projectId, 'C').id;
    const scene = t.svc.addScene(cut, 'S').id;
    t.svc.addPanel(scene, { intent: 'a', momentId: withSpeech });
    t.svc.addPanel(scene, { intent: 'b', candidates: [withSpeech, without] });
    const panels = t.svc.getCut(cut)!.scenes[0].panels;
    expect(panels[0].moment).toMatchObject({ speech: 'mal die Delfine.', speech_cut: 'start' });
    expect(panels[1].candidates.map((c) => [c.speech, c.speech_cut])).toEqual([['mal die Delfine.', 'start'], ['', null]]);
  });
});
