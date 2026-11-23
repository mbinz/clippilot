import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT, USER_PROMPT } from "../../../../src/core/analyze/prompts.js";

describe("USER_PROMPT", () => {
  it("has no numeric start_sec/end_sec in any example (avoids anchoring)", () => {
    const hl = USER_PROMPT.slice(USER_PROMPT.indexOf('"highlights"'));
    expect(hl).not.toMatch(/"start_sec":\s*\d/);
    expect(hl).not.toMatch(/"end_sec":\s*\d/);
  });

  it("requires timestamps to come from what is visible in the video", () => {
    expect(USER_PROMPT).toMatch(/im Video/);
  });

  it("asks for short English lowercase 1-3 word tags for setting and activity", () => {
    expect(USER_PROMPT).toMatch(/setting.*activity.*(English|Englisch)/is);
    expect(USER_PROMPT).toMatch(/1[-–]3 (words|Wörter)/i);
    expect(USER_PROMPT).toMatch(/lowercase|kleingeschrieben/i);
    expect(USER_PROMPT).not.toContain('"Ort/Setting"');
    expect(USER_PROMPT).not.toContain('"Aktivität"');
  });

  it("asks for a slowmo judgement per highlight with reason, none for speech", () => {
    expect(USER_PROMPT).toMatch(/"slowmo": "none \| light \| strong"/);
    expect(USER_PROMPT).toMatch(/slowmo_reason/);
    expect(USER_PROMPT).toMatch(/light/);
    expect(USER_PROMPT).toMatch(/strong/);
    expect(USER_PROMPT).toMatch(/Sprache/);
  });

  it("asks for tier/shot/role/issues per moment and no clip scores", () => {
    expect(USER_PROMPT).toMatch(/"tier": "hero \| solid \| filler"/);
    expect(USER_PROMPT).toMatch(/"shot"/);
    expect(USER_PROMPT).toMatch(/"role"/);
    expect(USER_PROMPT).toMatch(/"issues"/);
    for (const w of ['hero', 'solid', 'filler', 'wide', 'medium', 'close', 'detail', 'establishing', 'action', 'reaction', 'transition', 'shake', 'blur', 'obstructed', 'overexposed', 'underexposed']) {
      expect(USER_PROMPT).toContain(w);
    }
    expect(USER_PROMPT).not.toMatch(/technical_quality|editorial_value|suggested_use|"quality"|Bewertungsskala/);
  });
});

describe("prompt cleanup", () => {
  it("is neutral about family content and drops removed wording", () => {
    const all = SYSTEM_PROMPT + USER_PROMPT;
    expect(SYSTEM_PROMPT).toContain("Video-Analyse-Assistent für Reisevideos");
    expect(all).not.toContain("Familien");
    expect(all).not.toContain("Haare");
    expect(all).not.toContain("herausragende");
    expect(all).not.toContain("description_de");
  });

  it("lists every slowmo enum value in the example and narrows water", () => {
    expect(USER_PROMPT).toContain('"none | light | strong"');
    expect(USER_PROMPT).toContain("Wasser nur mit einem Ereignis (Welle bricht, Spritzer, Tier, Boot)");
  });

  it("asks for usable moments for a travel montage", () => {
    expect(USER_PROMPT).toContain("0 bis 8 brauchbare Momente für einen Reise-Montage-Film (leeres Array, wenn nichts taugt)");
  });
});

describe("audio tag prompt", () => {
  it("shows audio_keep and audio_type in the example and explains them", () => {
    expect(USER_PROMPT).toContain('"audio_keep": false');
    expect(USER_PROMPT).toContain('"audio_type": "ambient | speech | music | noise"');
    expect(USER_PROMPT).toMatch(/audio_keep = true nur, wenn der Originalton/);
    expect(USER_PROMPT).toMatch(/audio_type = was hauptsächlich zu hören ist/);
  });
});

describe("moment prompt v3", () => {
  it("asks for stable stretches of 3 to 8 seconds, several per long clip, covering the clip", () => {
    expect(USER_PROMPT).toContain('2 bis 8 Sekunden (meist 3 bis 6)');
    expect(USER_PROMPT).toMatch(/stabil/);
    expect(USER_PROMPT).toMatch(/mehrere Momente/);
    expect(USER_PROMPT).toMatch(/keine guten Teile zwischen den Momenten aus/);
  });

  it("starts after settling, ends before the camera leaves, avoids search moves", () => {
    expect(USER_PROMPT).toMatch(/beruhigt/);
    expect(USER_PROMPT).toMatch(/bevor die Kamera/);
    expect(USER_PROMPT).toMatch(/schwenkt, neigt oder zoomt.*außer die Bewegung selbst ist die Einstellung/s);
  });

  it("limits hero to about 10 percent of the best moments of a trip", () => {
    expect(USER_PROMPT).toMatch(/"hero" nur für die besten ca\. 10 %/);
    expect(USER_PROMPT).toMatch(/die meisten Momente "solid"/);
    expect(USER_PROMPT).not.toMatch(/gesamte Bandbreite/);
  });

  it("has a strict audio_keep rule", () => {
    expect(USER_PROMPT).toMatch(/im Zweifel false/);
    expect(USER_PROMPT).toMatch(/Meer- oder Windrauschen allein = false/);
  });

  it("allows 0 to 8 highlights and no longer 0 to 5", () => {
    expect(USER_PROMPT).toMatch(/0 bis 8/);
    expect(USER_PROMPT).not.toMatch(/0 bis 5/);
  });
});
