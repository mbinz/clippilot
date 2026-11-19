import { describe, expect, it } from "vitest";
import { USER_PROMPT } from "../../../../src/core/analyze/prompts.js";

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
    expect(USER_PROMPT).toMatch(/"slowmo": "none"/);
    expect(USER_PROMPT).toMatch(/slowmo_reason/);
    expect(USER_PROMPT).toMatch(/light/);
    expect(USER_PROMPT).toMatch(/strong/);
    expect(USER_PROMPT).toMatch(/Sprache/);
  });
});
