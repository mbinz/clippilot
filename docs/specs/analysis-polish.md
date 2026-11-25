# Analysis polish + full Portugal (Q1–Q4)

> Moved verbatim from STATUS.md (and PRD.md) on 2026-11-25. Old names ("roadmap item 2b", "M3", "below") refer to
> the former layout; the current todo list is in [STATUS.md](../STATUS.md).

### Roadmap item 2 — Analysis polish + full Portugal (planned 2026-11-23)

Why: on the board the moment *is* the edit, so the AI's moments must be good cuts. Example C0542: the analysis marked
0–3 s (still adjusting sunglasses) and missed the best stable stretch 4–9 s; the user trimmed it by hand. Decisions
(user, 2026-11-23): moments **3–8 s**, **several per clip**, **★ for ~1 in 10** moments (today ~26 %).

**Q1 — moment prompt v3 + normalisation** (test-first where code; prompt text checked by tests on its rules)
- Prompt (`src/core/analyze/prompts.ts`): moments = the best *stable* stretches a cutter would use, 3–8 s each; cover the
  clip — several moments for a long clip, don't skip good parts between moments; start after reframing/adjusting settles
  and end before the camera moves away; avoid parts where the camera pans/tilts/zooms in search of the subject unless the
  move itself is the shot. tier: "hero" only for the ~10 % best moments of a trip (opens or carries a scene), most moments
  "solid". audio_keep strict: only when the original sound carries the moment (laughter, a spoken line, a wave event);
  ambient sea/wind alone = false; "im Zweifel false". Keep the 0–5 limit → raise to 0–8 per clip.
- `highlights.ts`: `MAX_MOMENT_SEC = 8` — longer moments are shortened to 8 s centred (like the existing widening to 3 s);
  overlapping moments of one clip are merged or the later one is shifted to start at the earlier one's end (pick one,
  test it). A moment missing `description` defaults to "" instead of failing the clip (Arrifana: one clip failed 3×).
- Tests: normaliser (≤ 8 s, ≥ 3 s, overlap rule, clamping), schema accepts a missing description, prompt contains the
  3–8 s / ★ ~10 % / audio rules (cheap guard against regressions).

**Q1 result (implementer, 2026-11-23)** — done, not evaluated against real Gemini (that is Q2). Tests 865 → 881; typecheck green.
- `highlights.ts`: `MAX_MOMENT_SEC = 8` (exported). Pipeline: clamp → drop < 0.5 s → widen to 3 s → shorten to 8 s centred
  (stays inside the clip because it works on the already clamped range) → sort → overlap rule → round.
- **Overlap rule chosen: shift, not merge.** In start order, a moment starting before the previous kept moment's end is
  moved to start at that end (its end unchanged); if < 3 s remain it is dropped (fully contained moments vanish).
  Reason: merging could create > 8 s moments and blur the model's cut points. Touching moments are left alone.
- `schema.ts`: highlight `description` defaults to `""`; the normaliser also falls back to `""`.
- `prompts.ts`: German moment section rewritten (limit 0–8, stable 3–8 s, several moments, cover the clip, settle/leave rules,
  no search pans, hero ≈ 10 %, strict audio_keep). Also added "Die Momente eines Clips dürfen sich nicht überlappen." and
  "Im Zweifel "solid", nicht "hero"." (interpretation). Two existing prompt tests were updated because the spec changes
  that text: `0 bis 5` → `0 bis 8`, `audio_keep = true, wenn` → `audio_keep = true nur, wenn`; the old
  `gesamte Bandbreite` (use the full tier range) assertion was dropped since it contradicts "most moments solid".
- Full new German text for the moments (in `USER_PROMPT`, after the JSON example):

```
highlights: 0 bis 8 brauchbare Momente für einen Reise-Montage-Film (leeres Array, wenn nichts taugt). Ein Moment ist die beste stabile Einstellung, die ein Cutter tatsächlich verwenden würde, 3 bis 8 Sekunden lang. Bei längeren Clips wähle mehrere Momente und decke den Clip ab: lass keine guten Teile zwischen den Momenten aus. Beginne einen Moment erst, nachdem sich das Bild beruhigt hat (Umrahmen, Einstellungen anpassen, Kamera zurechtrücken sind vorbei), und beende ihn, bevor die Kamera wegschwenkt oder sich vom Motiv entfernt. Vermeide Stellen, in denen die Kamera auf der Suche nach dem Motiv schwenkt, neigt oder zoomt, außer die Bewegung selbst ist die Einstellung. Die Momente eines Clips dürfen sich nicht überlappen.
tier: wie stark der Moment als Einstellung in einem Reise-Montage-Video ist. "hero" nur für die besten ca. 10 % aller Momente einer Reise (würde eine Szene eröffnen oder tragen); die meisten Momente "solid" (gute, brauchbare Einstellung); "filler" = nur als Lückenfüller brauchbar. Im Zweifel "solid", nicht "hero".
audio_keep = true nur, wenn der Originalton den Moment trägt (Lachen, eine gesprochene Ansage, ein Wellen-Ereignis wie eine brechende Welle, Live-Musik), sonst false; im Zweifel false. Meer- oder Windrauschen allein = false. audio_type = was hauptsächlich zu hören ist: "ambient" = Umgebungsgeräusche, "speech" = Sprache, "music" = Musik, "noise" = nur Wind, Rauschen oder Störgeräusche.
```

**Q1b result (implementer, 2026-11-23)** — re-analysis dedupe + 2 s minimum, from the Q2 eval (C0542: user trim 3.5-9.5 s,
v3 added a near-duplicate 1.5-8.5 s; 3 of 10 user trims were < 3 s).
- `HighlightRepository.replaceForClip`: after the replaceable moments are deleted, a new item is skipped when its overlap
  with any remaining moment of the clip (kept = confirmed, rejected, edited, user_tier, used by panel/candidates) is
  >= 50 % of the new item's own length. Uses the kept moment's current start/end (the user's trim). Rejected moments
  count too (the user said no to that stretch). Clips without kept moments behave as before.
- `MIN_MOMENT_SEC = 2` (was 3): widening and the overlap rule's "drop if < min" follow. Prompt length rule now
  "2 bis 8 Sekunden (meist 3 bis 6) lang".
- Existing tests updated because behaviour changed: normaliser widening/overlap expectations (3 s -> 2 s), prompt guard,
  two analyze-clips tests (widened range 2.3-4.3; "Fresh" moved so it no longer duplicates the confirmed "Keep"), and
  the repository "keeps decisions" test (re-inserting an identical range as "confirmed again" is now dropped).
- Follow-up: an AI draft (`addPanel`, source != 'user', moment still proposed) with explicit in/out now also sets `ai_start_sec/ai_end_sec` to the written range, so the board no longer says "changed by you" for untouched moments; speed has no ai column and stays as is (board flags range only; history compares it to the computed default).

**Q2 — evaluation on Arrifana (planner, cost shown first)**
- Script `scripts/eval/moment-eval.ts`: on a **copy** of the Arrifana DB, re-analyse a sample (~15 clips the user touched:
  trimmed, 👎 or placed) with prompt v3 without touching the real DB; report per clip the new moments vs the user's
  trims (overlap), length distribution, ★ share, audio_keep share. Planner + user judge; iterate the prompt if needed.

**Q2 result (planner, 2026-11-23)** — eval on a copy (22 clips: 17 the user had touched + 5 untouched, < $1): v3 median
moment 5.0 s (always 3–8; old up to 21 s), ★ 30 % → 9 %, audio_keep 72 % → 19 %, user trims matched 5/10 → 6/10 (3 of
the user's trims were < 3 s → min lowered to 2 s in Q1b), "shake" rejects re-proposed 0/5, "boring" 4/7 (two clips the user
found boring overall). Re-analysis kept user moments and added near-duplicates → Q1b dedupe rule.
**Arrifana reset + v3 run (2026-11-23, user decision: "my changes were playful")** — backup `clippilot.pre-reset.db`; all
moments, scenes, panels and history deleted (clips, events, brief kept); `analyze --force` on 104 clips (0 errors): 167
moments, avg 5.2 s, ★ 16 %, audio_keep 19 %. Brief must-haves remapped to the new moments (same text; kiss → the
"Schön hier!" moment 241). Claude draft applied: 5 scenes, 37 panels, 2:48 for a 2:45 target, 0 moments "changed by
you" (fix b2d6560: an AI draft's range is the AI range). ★ at 16 % is above the ~10 % target — watch on Portugal.

**Q3 — small analysis fixes**
- Event names trimmed (folder "Praia do Odeceixe "); event times/names in the footage's time zone: project config
  `timezone` (IANA, default = system) used by `deriveEvents` and time-group names; set `Europe/Lisbon` for Portugal.
- `proxies rebuild --only-bad` also rebuilds proxies whose keyframes are > 2 s apart.

**Q3 implementation spec (planner, 2026-11-24)** — test-first, three behaviours:
- **Q3a trimmed folder names:** `deriveEvents` names a folder event `path.basename(f).trim()`. Test: a leaf folder
  `"…/Praia do Odeceixe "` yields the event name `"Praia do Odeceixe"`; `folder_path` keeps the real path (with space).
- **Q3b time zone:** `formatEventTime(ms, timeZone?)` formats weekday/day/month/hh:mm in the given IANA zone via `Intl`
  (undefined = system zone, today's behaviour). `deriveEvents(clips, { timeZone })` / `timeGroups` pass it on. Project
  config key `timezone` (IANA string, unset = system); invalid zones are rejected when set (`config set`) with a clear
  error. Wherever events are derived (events index / CLI) the project's `timezone` is used. Tests: the same instant
  formats differently for `Europe/Lisbon` and `Asia/Tokyo` (incl. a day rollover); a time group is named in the given
  zone; config rejects `Mars/Olympus`.
- **Q3c `--only-bad` keyframe gap:** pure `maxKeyframeGap(keyframeTimes: number[], duration: number): number` (largest gap
  between consecutive keyframes, incl. the last keyframe → end); `rebuildProxies` with `onlyBad` skips a proxy only when
  it is yuv420p (yuvj420p counts as fine too) **and** its max keyframe gap ≤ 2 s. Keyframe times from ffprobe
  (`-skip_frame nokey -select_streams v:0 -show_entries frame=pts_time`). Tests: `maxKeyframeGap` cases (1 s grid, a 10 s
  gap, a single keyframe, a clip shorter than 1 s); `rebuildProxies` with an injected probe rebuilds a yuv420p proxy with
  a 10 s gap and skips a good one. Update the CLI option help text.
- Done when: `npm run typecheck && npm run test:all` green; no change to Arrifana data (planner re-derives events).

**Q3 result (2026-11-24)** — ✅ 7fb24d2 (907 tests). Implementer also trims names of incrementally created folder events.
Planner checks: real ffprobe keyframe probe → rebuilt Arrifana proxies 1 s, an old M2-pilot proxy 5.02 s (would be
rebuilt); Arrifana event 4 renamed to "Praia do Odeceixe" via `events rename` (no rebuild, scenes keep their event ids);
Arrifana project config `timezone = Europe/Lisbon`; `Mars/Olympus` rejected. Deferred: `loadConfig` doesn't validate a
hand-edited bad zone (Intl would throw at derive time); unset timezone isn't shown by `config show`.

**Q4 — full Portugal** (after Q1–Q3; user OK on the Gemini cost estimate first)
- `~/Video/ClipPilot Portugal/`: ingest `~/Video/Portugal` (508 clips, 123 GB; resumable, overnight), analyze with
  prompt v3, events, then Claude proposes a brief per user wish.
