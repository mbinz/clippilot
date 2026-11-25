# Draft quality (T, S, J, W, D, C, F, B, A, P slices + acceptance test)

> Moved verbatim from STATUS.md (and PRD.md) on 2026-11-25. Old names ("roadmap item 2b", "M3", "below") refer to
> the former layout; the current todo list is in [STATUS.md](../STATUS.md).

### Roadmap item 2b — Draft quality (grilling 2026-11-24)

Why (user, after the Arrifana import): clips marked "stabilize" were really too shaky to use, while nearly every other
handheld clip needs stabilizing; a clip at the start of chapter 2 belonged to chapter 1; the last clip of chapter 1
holds a static image too long; and the drafter can't judge speech scenes without a transcript. Today Claude drafts in
chat from `moments list` text only (Gemini descriptions + tags, no frames, no transcript; 51 of 167 Arrifana moments
are `speech`). Decisions: PRD "Principles" (human changes protected, reviewers don't edit) + roadmap item 2b.
Grilling notes not in the PRD: stills for the cut critic every 0.5 s + the last frame; critics may *mention* protected
items (listed for the user) but Claude never changes them; story-critic preview has no music; acceptance set grows with
real cases (two cases alone are too few). Gimbal footage only in "Farol" (calibrate the locked band there).

**T1 — transcript (planner spec, test-first)**
- Engine: `whisper-cli` (whisper.cpp, Homebrew, present) with a multilingual model; global config `whisper_model` (path,
  default `~/.clippilot/models/ggml-large-v3-turbo.bin`). Model download is a separate, user-approved step (≈1.6 GB);
  without the model `transcribe` exits with a clear message (no silent skip). Only `ggml-medium.en` exists today
  (English-only, not usable).
- Audio: ffmpeg → 16 kHz mono WAV in a temp dir from the original (proxy if the original is missing); clips with
  `has_audio = 0` are skipped. whisper-cli with `-l auto` and JSON output incl. token/word timestamps; parse into
  `segments [{start, end, text}]` and `words [{start, end, text, p}]` (seconds, clip time).
- Hallucination guard (pure, tested): drop segments that are empty/punctuation-only, have very low mean token
  probability, or match known whisper filler phrases ("Untertitel im Auftrag des ZDF", "Vielen Dank fürs Zuschauen",
  "Thanks for watching", "♪"…); keep the list in one constant.
- Storage: migration 019 `transcripts (clip_id PK → clips, language, model, text, segments_json, words_json,
  created_at)`; transcript text added to the clip search (FTS) so `search "Delfin"` finds spoken words.
- CLI: `clippilot transcribe [--project] [--force] [--json]` (sequential, resumable: skips clips that have a transcript
  unless `--force`); `analyze` runs it afterwards for clips without one when the model is configured, else prints a hint.
- Moments: pure `speechForRange(segments, words, start, end)` → `{ text, cut: null | 'start' | 'end' | 'both' }` (cut =
  a segment crosses the boundary); `moments list --json` and `cut show --json` (moment) carry `speech` + `speech_cut`.
- Snap (pure `snapToSpeech(range, segments)`): a range touching speech is widened to the start of the segment at its
  start and the end of the segment at its end; **no upper length cap for speech moments**; clamped to the clip. Applied
  by `transcribe` to **unprotected** moments only (protected = what `replaceForClip` keeps: confirmed, rejected, edited
  range/speed/★, or used by a panel/candidate list) — sets start/end and ai_start/ai_end; and in the analyze normaliser
  when a transcript exists (the 8 s cap is skipped for ranges extended by speech).
- Tests first: whisper JSON parsing (fixture from a real run on a short generated German TTS clip or a hand-written
  fixture in whisper.cpp's format), hallucination filter, speechForRange cases (inside, crossing start/end/both, none),
  snapToSpeech (widen, no cap, clamp, untouched without speech), protected moments not snapped, migration + FTS hit,
  transcribe resumability with an injected runner. One integration test with the real whisper-cli is skipped when the
  model file is absent.
- Done when: typecheck + test:all green; planner downloads the model (after user OK), runs `transcribe` on Arrifana,
  spot-checks 5 speech moments, and reports how many moments were snapped.
- **T1 implemented (2026-11-24, branch `t1-transcript`)**: `clippilot transcribe [--project] [--force] [--json]`; migration 019
  (`transcripts` + `clips.transcript_text` mirrored into `clips_fts`); `src/core/transcribe/{whisper,speech,runner,index}.ts`;
  `HighlightRepository.findUnprotected/snapUnprotected` (the protected definition, shared with `replaceForClip`);
  `speech`/`speech_cut` on `moments list --json` and on `cut show --json` moments/candidates; `analyze` snaps with an existing
  transcript and transcribes afterwards (or prints a hint). Deferred: board drawer (T2), SKILL.md mention, `transcript_text`
  is also part of clip JSON (search/get-clip output).
- T2 (next): board drawer shows the transcript (moment part highlighted); then the motion slice.

**T1 result (planner, 2026-11-24)** — ✅ T1 + T1b–T1d on branch t1-transcript (999 tests). Models (user-approved
downloads): `~/.clippilot/models/ggml-large-v3-turbo.bin` (1.62 GB, sha1 4af2b29d…) and `ggml-silero-v5.1.2.bin`
(VAD, 0.9 MB). Arrifana took four runs (each from the backup `clippilot.pre-019.db`; junk run kept as
`clippilot.junk-019.db`):
1. no VAD: whisper hallucinated on wind/sea in ~60 clips (Japanese/Russian subtitle credits, "*sad music*", loops),
   79 moments snapped on junk → T1b: VAD, `-sns -mc 0`, project `languages` (Arrifana: de,en,pt), sound-description /
   repetition / short-low-p filters, phrase list.
2. VAD 0.5: junk gone but real speech in wind lost (pt guide → "Tchau, tchau.") → T1c: VAD threshold 0.15 + 200 ms pad
   (measured on C0567/C0522/C0572 vs sea clips), fallback over allowed languages, 80 % repetition rule (≥ 6 words only,
   so kids' "Mama, Mama!" / "Ja, ja, ja." survive).
3. VAD 0.15: speech fully back, but classic English wind hallucinations with token p 0.8–0.9 ("I'm going to go to the
   next one." in ~15 clips) — confidence can't separate them → T1d: project-level cross-clip filter (same normalised
   text in ≥ 3 clips = dropped; raw segments kept in migration 020) + exact-phrase list.
4. Final: 104 transcribed, 36 with text, ≈ 28 genuine (kids, adults, pt/en boat guides), ≈ 8 short leftovers ("He'll be
   mouse.", "A CIDADE NO BRASIL", "Shhh. Sss."); 4 language fallbacks; 32 unprotected moments snapped (13 clamped at a
   neighbour, 2 skipped). Panels/protected moments untouched. Whisper text of kids' speech is approximate ("Bier und
   Blut") — fine for drafting context, not for subtitles.
**T2 — transcript in the moment drawer + skill (planner spec, 2026-11-24)** — test-first where logic.
- API: `GET /api/clips/:id/transcript` → `{ language, segments: [{start, end, text}] }`, or `{ transcript: null }` when the
  clip has none / an empty one. Route test.
- Pure `transcriptView(segments, start, end)` in `web/src/board/drawer.ts` → `[{ text, start, inMoment }]` (inMoment = the
  segment overlaps [start, end]) plus `cut: null | 'start' | 'end' | 'both'` for the focused moment; unit tests (inside,
  crossing, none, empty).
- MomentDrawer: a quiet "Spoken" block under the description, only when there is text: the clip's segments as running
  text, segments inside the focused moment in normal text colour, the rest dimmed; if the focused moment cuts a sentence,
  one small line "Sentence cut at the start/end". Fetched once per clip, cached like the other clip info. Nothing on the
  tiles (calm board). No new colours (one meaning per colour).
- Skill (`.claude/skills/clippilot/SKILL.md`): `clippilot transcribe` in the verb table; `moments list` rows carry
  `speech` / `speech_cut`; drafting rules: read `speech` to judge what a moment is about; avoid moments with
  `speech_cut` unless nothing better; kids' speech is transcribed only approximately — never quote it as exact.
  Run `npm run skill:install` is the user's call (don't run it).
- Done when typecheck + test:all green; planner checks the drawer in the browser on Arrifana (e.g. C0567, C0548).
**S1 — motion measurement: shake + stillness per moment (planner spec, 2026-11-24)** — PRD 2b.2, test-first.
- Port the pure motion code from resolve-prep (`~/dev/clippilot-post/src/stabilize/motion.ts`: `globalShift` SAD block
  matching on the centre 60 %, `jitterScore` = RMS of path − centred 0.5 s moving average in % of width, `maxPx`;
  `frames.ts`: ffmpeg decode of a range at native fps, 320 px wide gray8 rawvideo) into `src/core/motion/` with its tests.
  Calibrated on Arrifana 2026-11-24: tripod = 0, handheld 0.04–0.35, too shaky ≥ 0.43 (user-judged in Resolve).
- New pure measures from the same aligned frames: `cameraMotion` = mean |velocity| of the moving-average path in % of
  width per second (smooth pan/tilt speed); `frameChange` = mean absolute luma difference (0–1) between consecutive frames
  after compensating the global shift (people, waves, action). Both are raw numbers for the cut critic; no band.
- Shake band (pure `shakeBand(score, cfg)`): `locked` < `shake_locked_max` (default 0.02), `stabilize`, `shaky` ≥
  `shake_shaky_min` (default 0.4); keys in project/global config.
- Storage: migration 021 on `highlights`: `shake_score REAL`, `shake_max_px REAL`, `camera_motion REAL`,
  `frame_change REAL`, `motion_start_sec REAL`, `motion_end_sec REAL` (the range that was measured). A moment counts as
  measured when its current start/end equal the measured range (±0.01 s); trimming makes it stale → re-measured next run.
- CLI `clippilot motion [--project] [--force] [--json]`: measures every moment that is unmeasured or stale (all with
  `--force`), sequential, resumable, decode from the original (proxy if missing) at the clip's native fps; reports
  measured / skipped / failed and the band counts. `analyze` runs it after transcribe. Measuring is read-only for
  edits: it never changes ranges, status or source (protected or not).
- Output: `moments list --json` rows and `cut show --json` moments carry `shake: { score, band } | null` and
  `motion: { camera, change } | null` (null = not measured / stale).
- Tests first: ported motion tests; cameraMotion (static 0, constant pan = its speed); frameChange (identical frames 0,
  shifted identical frames ≈ 0 after compensation, changed content > 0); shakeBand boundaries; staleness after a trim;
  migration; CLI JSON counts with an injected frame source; one tiny generated-media integration test (decode → scores).
- Done when typecheck + test:all green; planner runs `motion` on Arrifana (167 moments, ~10 min) and checks the band
  counts against the resolve-prep numbers for the 37 cut panels (5 locked / 19 stabilize / 13 shaky).
- Then (separate, resolve-prep R1): `stabilize` reads the band from cut.json (`moment.shake`) and only measures itself
  when a panel has none.

**S1 result (implementer, 2026-11-24):** `src/core/motion/{motion,frames,index}.ts`, migration 021, `clippilot motion`
(also run by `analyze` after transcribe), `shake`/`motion` on `moments list --json` and `cut show --json`. Not run on real data.
Deferred: `cut`/`moments` CLI and the web routes use the default band thresholds (the `StoryboardService` takes an optional
config; `withSvc` is sync and does not load config yet); `motion` itself honours `shake_locked_max`/`shake_shaky_min`.

**T2 + T1e + S1 results (planner, 2026-11-24)** — merged (1043 tests). T1e: whisper+VAD returned coarse segments (C0599:
one 0–44.6 s segment) → sentences are now derived from word timings (split at . ? ! … or pauses ≥ 0.7 s) for speech cut,
snap and the drawer. T2 checked in the browser on Arrifana: the moment drawer shows "Spoken" per sentence, the moment's
sentences highlighted, "Sentence cut at …" when it applies. Final Arrifana run (from `clippilot.pre-019.db`): transcribe
24 moments snapped (3 clamped, 2 skipped), 47 moments carry speech, 8 cut a sentence (all protected → left for the
critic/user, e.g. house panel 1 inside "2, 3, 4, 5, 9."); motion 167 measured, 0 failed: locked 19 / stabilize 75 /
shaky 73 — the 37 cut panels match resolve-prep exactly (5 / 19 / 13). Deferred: band thresholds from config only in the
`motion` command (cut show / web use defaults); SKILL.md lacks `motion`; `skill:install` not run.

Open: precision on the ≈ 8 leftovers (idea: cross-check with Gemini's per-moment `audio_type` or a second VAD pass);
SKILL.md mention of `transcribe`/`speech` (done in T2); T2 drawer (done).

**W0 — Wackler prototype (planner + user, 2026-11-24)** — decided in grilling Q24–Q29: shake work moves from one number
per moment to a **per-clip camera-motion curve**; single jolts ("Wackler") are found per clip and only **marked**
(Q26a: analysis marks; only AI-moment *boundaries* lying inside a Wackler move to its edge), the drafter (Claude) decides
keep vs cut out (two panels), the cut critic checks, protected moments only get a hint (Q26b); covering with B-roll is a
suggestion + resolve-prep marker only, no second track in ClipPilot yet (Q26c). Light-jitter calibration (subpixel,
"locked" band) is **deferred**; Farol (gimbal) is **not** a good test set (user).
- Prototype (throwaway, in `~/Video/ClipPilot Arrifana/exports/wackler-eval/`: `measure.mts`, `measure2.mts` (+ left/right
  halves), `detect.py`, `shake_review.py`, `candidates.json`, user `verdicts.json`): ffmpeg gray 320 px, whole clip, native
  fps; global shift per frame by SAD, coarse (160 px, ±8) → fine (320 px, ±1) = ±16 px range; ~12 min for 104 clips
  (25 min footage) with 3 workers.
- **Bug found:** `-hwaccel videotoolbox` silently drops frames on the Sony 10-bit H.264 files (C0589: 1506 of 2472
  decoded) → the curve drifted against the video. Never use VideoToolbox for measuring; the prototype now checks decoded
  frames = `nb_read_packets`. (ClipPilot S1 `decodeFrames` doesn't use hwaccel — unaffected.)
- Curve that matched the user's perception: **shake speed** = |velocity smoothed over ~0.08 s − camera velocity averaged
  over 0.5 s| in % of frame width per second (a position-based residual looked early/smeared). Candidate = above
  max(3 × clip median, 12 %/s), grown while > half that, gaps < 0.25 s merged, ≤ 2 s long; clips with median > 8 %/s =
  "continuously shaky" (16 clips, no Wackler search).
- Result: 144 candidates in 51 clips; user judged 141: **100 real / 41 not (precision 0.71)**. Peak strength barely
  separates (only > 60 %/s is 7/7). User: works very well for clear cases (flat line + clear spike); weaker in action
  scenes (boat: everything shaky, extra spikes, "editor's choice"); birds clip C0561 (100 fps) 0/5; some moments have
  several spikes but only one was marked, often not the disturbing one.
- Rule experiments against the verdicts (`all3.json` measure with left/right halves):
  - left/right halves disagree (ratio of half-disagreement to global motion ≥ 0.8) = subject motion (kid close to the
    camera, birds), not camera → drop: precision 0.78, recall 0.88 (drops 16 no / 12 yes); ≥ 0.6: 0.82 / 0.85.
  - judging speed at playback rate (×25/fps for 50/100 fps): 0.75 / 0.84 — but the user judged proxies at source speed,
    so this can't be validated with these verdicts.
  - both + "continuously shaky" stricter (median < 5): 0.89 / 0.63 — too many real ones lost.
- **Answered by the user (2026-11-25):**
  1. Subject-motion rule: yes, drop candidates with half-disagreement ratio ≥ 0.8 (precision 0.71 → 0.78).
  2. Several shakes in one moment: mark **every** shake separately; what makes one disturbing is the **jump distance**.
  3. Slow motion: clear shakes look disturbing at any speed; only border cases may change. Since jump distance (px) does
     not depend on playback speed, rank by distance at source speed; a border-case shake in a panel the cut plays slowed
     down gets **lower confidence** (not dropped).
  4. High-jitter scenes (boat, action): keep their shake candidates, mark them "in moving scene" (lower confidence).
  5. No remembered examples. Recall gets measured **after W1** instead: a Chrome review page with ~30 near misses
     (candidates just below the threshold); every "yes" there is a missed shake.
- **Border experiment (user idea, 2026-11-25):** subjects sit mostly in the middle, so the frame border shows best
  whether the camera moves. Prototype `measure3.mts` + `evaluate.py` (same dir; `all4.json` = per-frame shifts of centre,
  left/right halves and 8 border patches + patch texture, 51 candidate clips, 6.5 min with 8 workers): every patch gets
  its own shake residual; camera = median of the textured patches (texture = mean gradient ≥ 4); **patch disagreement**
  = median distance of the patch residuals from that consensus ÷ consensus, summed over the candidate. Against the
  141 verdicts (baseline P 0.71 / R 1.00):
  - halves ratio < 0.8 (W0 rule, reproduced): P 0.79 / R 0.87 (drops 18 no / 13 yes).
  - border patch disagreement < 0.5: **P 0.83 / R 0.90** (drops 22 no / 10 yes); stable for texture 2…8.
  - lost "yes" include the two strongest shakes (122 and 75 %/s): a jump beyond the ±16 px search range makes patches
    disagree → **always keep peaks ≥ 60 %/s** (all 7 were real): **P 0.83 / R 0.93** (halves + same exception: 0.80 / 0.90).
  - border-only detection (re-detecting on the consensus curve, drop if its peak < 0.5 × its own threshold): drops 8 no,
    0 yes (P 0.75 / R 1.00) — safe but weak on its own; adds nothing on top of the disagreement rule.
  - left over: birds C0561 (100 fps, birds fill the border too) 4 no, GoPro GH010376 (boat) 4 no — "in moving scene" cases.
  - Caveat: thresholds picked on the same 141 verdicts (differences of 3–4 items); the near-miss review after W1 and new
    footage are the real check.
  - **Planner recommendation for W1:** border-patch disagreement < 0.5 + keep peaks ≥ 60 %/s, instead of the halves rule.

**J1 — rename shake → jitter, drop Gemini's shake tag (planner spec, 2026-11-25; before W1)**
Vocabulary decided by the user: a **shake** is a single jolt (was "Wackler"); **jitter** is the continuous handheld
micro-movement present in every handheld shot. Today the code calls jitter "shake" (S1) → rename first so W1 can use
"shake" for the events. Gemini's `shake` issue is dropped: a yes/no guess from the proxy, replaced by the measurement.
- Migration 022: `highlights.shake_score` → `jitter_score`, `shake_max_px` → `jitter_max_px` (`ALTER TABLE … RENAME
  COLUMN`); remove `"shake"` from every stored `highlights.issues` JSON array. Test on a DB with migration 021 data.
- Code: `ShakeBand`/`shakeBand`/`ShakeBandConfig` → `JitterBand`/`jitterBand`/`JitterBandConfig`; bands keep their names
  (`locked` / `stabilize` / `shaky` — they describe the jitter level); config keys `shake_locked_max`/`shake_shaky_min` →
  `jitter_locked_max`/`jitter_shaky_min` (the user's `~/.clippilot/config.json` has no shake keys → nothing to migrate;
  no fallback for old keys); `HighlightRecord`, repository, `motion` command texts, `MomentMotion.shake` →
  `.jitter`.
- JSON contract: `moments list` / `cut show` / `cut.json` moment field `shake: {score, band}` → `jitter: {score, band}`,
  no fallback (user decision). **resolve-prep** (`~/dev/clippilot-post`: `src/cut.ts`, `src/stabilize/run.ts`,
  `src/stabilize/mark.ts`) reads `moment.jitter` in the same session — both repos land together.
- Analysis: `shake` removed from the issues enum (`analyze/schema.ts`) and the prompt (`analyze/prompts.ts`); remaining
  issues: blur, obstructed, overexposed, underexposed. `calibrate` (`calibration/sampling.ts`) uses the measured jitter
  band (`shaky`) instead of the issue tag.
- Not renamed: the user's 👎 reject reason `shake` (MomentDrawer, review page) — human data, stays as stored.
- Docs: PRD issues list (line "issues `shake` …"), ARCHITECTURE decision 8, SKILL.md wording.
- Done when: unit + integration green, typecheck clean, resolve-prep tests green, pilot DB migrated (backup first), the
  Arrifana `cut show --json` shows `jitter` and no `shake`, resolve-prep still marks the Arrifana cut the same way.

**J1 result (2026-11-25):** ✅ ClipPilot 733dbc2 (1048 tests), resolve-prep 3e00bb0 (114 tests). Migration 022 renames
`shake_score`/`shake_max_px` → `jitter_score`/`jitter_max_px` and strips `shake` from stored issues; the analysis schema now
drops unknown issue values instead of failing the clip (planner addition: a retired tag must not cost a retry). Pilot DB
migrated (backup `clippilot.pre-022.db`); Arrifana had 0 stored `shake` issues; `cut show` bands for all 37 panels identical
before/after, no `shake` key left. resolve-prep reads `moment.jitter`, old `shake` key = unmeasured.

**Autonomous run 2026-11-25 — decisions & assumptions for the user to review before the acceptance test.**
The user asked: carry on through W1, 2b.3–2b.6 (draft rules, cut critic, story critic, review loop) without stopping,
document every assumption. Each item below is marked [D-n] and referenced from the specs.
- [D-1] Shake "jump distance" = largest distance of the camera path from its 0.5 s moving average inside the shake, in % of
  frame width (`jump_pct`) and in source pixels (`jump_px` = jump_pct × source width / 100). Ranking/strength in the UI uses it.
- [D-2] Confidence `low` when the clip is a "moving scene" (median shake residual ≥ 4 %/s) or the patch disagreement is
  0.3–0.5, unless the peak is ≥ 60 %/s; and at output time, a shake whose peak is < 1.5 × the clip threshold in a moment
  played slowed down (speed < 1). Everything else `high`. Thresholds from the prototype data, not separately validated.
- [D-3] Clips with median residual > 8 %/s stay "continuously shaky": no shake search (their jitter band is `shaky` anyway).
- [D-4] Motion is measured once per **whole clip** (clips with at least one non-rejected moment, not hidden); moment jitter /
  camera motion / frame change are derived from the stored per-frame arrays for any range → trims never need a re-decode.
  The centre shift switches from S1's ±8 px search to the prototype's coarse-to-fine ±16 px; bands are re-checked against
  S1 on Arrifana (stop and report if > 5 % of moments change band).
- [D-5] AI-moment boundary nudge: only unprotected moments; a start inside a shake moves to the shake's end, an end to its
  start; skipped if the moment would get shorter than 2 s or would newly cut a sentence. Reported as a count.
- [D-6] Board: one small neutral icon on a tile (no new colour) when the moment's jitter band is `shaky` or it contains a
  high-confidence shake; details only in the drawer; shakes as small ticks on the drawer's clip timeline.
- [D-7] Draft rules are enforced as **warnings** from `cut apply` (never errors, never auto-reject): shaky moment used
  although a calmer moment exists in its dup group → `shaky_alternative`; shaky moment kept because it is ★ / a brief
  must-have with no calmer alternative → `shaky_kept` (the drafter must name these in the draft summary). Length: a moment
  > 8 s gets `too_long` unless it carries speech or is an action moment (role `action`, frame change ≥ 0.03 or camera motion
  ≥ 2 %/s), which may run to 20 s.
- [D-8] Cutting a shake out = draft panel field `cut_out: [from, to]` → the moment is trimmed to before the shake and a
  sibling moment (same clip, copied tags, `split_of`) after it gets its own panel right behind; same as CLI
  `moment cut-out <id> <from> <to>`. Both stay AI decisions (not confirmed) when done by the drafter/loop.
- [D-9] Edits Claude makes in the review loop use `--ai` on the moment verbs (trim / speed / cut-out): the moment stays
  unconfirmed (an AI pick, visually distinct, still changeable by later rounds). Without `--ai` the verbs behave as today
  (user decision → confirmed/protected).
- [D-10] Cut critic = Claude sub-agent `cut-critic` (model **sonnet**, reads per-panel still strips) + skill with the rules;
  input from `clippilot critic context`; it writes findings JSON and saves it with `clippilot critic save`. It never edits.
- [D-11] Story critic = `clippilot critic story`: 480p preview from proxies (keep-audio panels full volume, others −18 dB
  bed, no music, small burned-in panel label "S2·P3" top-left so findings can name panels), sent to **gemini-2.5-pro**
  (config `story_critic_model`) with the brief and the panel list. Without `--yes` it only prints the cost estimate
  (Gemini 2.5 Pro list price: $1.25 / M input tokens ≤ 200 k, $10 / M output; video ≈ 300 tokens/s incl. audio) — the
  loop shows that estimate to the user and needs their OK once per loop (covering up to 3 rounds).
- [D-12] Findings JSON (both critics): `{critic, cut_id, round, findings: [{id, severity: must|should|nit, kind, panel_id?,
  moment_id?, scene_id?, message, proposal?, protected}]}`, kinds `trim | replace | remove | reorder | move_scene | speed |
  cut_out | other`; stored in `.clippilot/reviews/<timestamp>-<critic>-r<round>.json`; `critic resolve` records applied /
  skipped / protected per finding so the change list can be printed (`critic summary`).
- [D-13] Loop: max 3 rounds; apply must + should that are not protected; nits are listed, not applied; protected items are
  listed for the user; stops early when a round has no must/should. Story critic runs in round 1 and in the last round
  only (cost), cut critic every round.
- [D-15] Moments are shared between cuts ("the moment is the edit"): AI trims the loop makes on the "Acceptance" cut also
  change those moments in "Main" (only unprotected ones). Backup before seeding: `clippilot.pre-acceptance.db`.
- [D-16] The planner spent ≈ $0.60 of Gemini credits on test runs of the story critic (one failed on the retired model).
- [D-17] (W1) The boundary nudge uses high-confidence shakes only.
- [D-18] The review loop is its own skill (`review-loop`) next to the `cut-critic` skill + agent, not a section of the
  clippilot skill; `npm run skill:install` now installs all three skills and the agent.
- [D-19] (D1) see "D1 result": draft speed records `ai_speed`; "★" = effective hero; action = role OR change OR camera.
- [D-14] Acceptance prep: the planner copies the Arrifana cut "Main" into a cut "Acceptance" and seeds ~10 faults
  (key in `~/Video/ClipPilot Arrifana/.clippilot/reviews/acceptance-key.md`, not in the repo, so the user can stay blind).
  The user's two real cases (chapter-2 clip belonging to chapter 1; last clip of chapter 1 holds a static image too long)
  are part of it.

**W1 — per-clip motion curve + shakes (planner spec, 2026-11-25)** — test-first. Algorithm = the prototype
(`~/Video/ClipPilot Arrifana/exports/wackler-eval/measure3.mts`, `detect.py`, `evaluate.py`), see "Border experiment".
- Pure code `src/core/motion/curve.ts` (+ tests): per frame pair on 320 px gray frames: centre shift (coarse half-res ±8
  → full-res ±1 refine, i.e. ±16 px), 8 border-patch shifts + patch texture (mean gradient), frame change (mean abs luma diff
  after compensating the centre shift, as S1 `frameChange`). `shakeResidual(shifts, fps, w)` = |velocity smoothed ~0.08 s −
  velocity averaged 0.5 s| in % width/s. `detectShakes(...)`: threshold hi = max(3 × clip median, 12), grow while > hi/2,
  merge gaps < 0.25 s, drop > 2 s, no search when median > 8 [D-3]; subject-motion filter: keep if patch disagreement < 0.5
  (textured patches ≥ 4, at least 3 else all patches) or peak ≥ 60 %/s; jump distance [D-1]; confidence [D-2].
- Derivation (pure): `momentMotion(curve, start, end)` → jitter score + max px (S1 formula on the stored centre shifts),
  camera motion, frame change — for any range, no decode [D-4].
- Storage: migration 023: `motion_curves (clip_id PK → clips, fps, frames, width, src_width, dx BLOB (Int8), dy BLOB (Int8),
  change BLOB (Float32), median_residual, continuous INTEGER, measured_at)` and `shakes (id PK, clip_id → clips, start_sec,
  end_sec, peak_sec, peak, jump_pct, jump_px, disagreement, moving_scene INTEGER, confidence)`.
- `clippilot motion [--project] [--force] [--json]`: decodes whole clips without a curve (all with `--force`; same ffmpeg
  decode as S1, no hwaccel, frame count checked against `nb_read_packets` — fail the clip on mismatch), stores curve +
  shakes, then (re)writes the highlights jitter/motion columns for every moment from the curve, then the boundary nudge
  [D-5]. Reports clips measured / failed, shakes (high / low), moments nudged, band counts. Sequential decode is fine;
  report the run time.
- Reads: `moments list --json` rows, `cut show --json` moments and candidates carry `jitter` (derived from the curve when the
  stored columns are stale, e.g. after a trim) and `shakes: [{start, end, peak_at, strength, jump_pct, jump_px, confidence,
  moving_scene}] | null` (overlapping the moment's current range, clip time; null = clip not measured; confidence applies
  the slow-motion rule of [D-2] with the moment's speed).
- Drawer [D-6]: shakes as small ticks on `ClipTimeline` (moment drawer), one quiet line per shake in the moment's range
  ("Shake 0:04.2 · jump 3 % (58 px) · low confidence — moving scene"), jitter band shown in the same block.
- Eval: `npm run eval:shakes -- <project dir>` (not part of test:all) compares detected shakes with
  `tests/fixtures/shakes/arrifana-verdicts.json` (the user's 141 verdicts, keys `<file name>@<start>`; match = overlap) and
  prints precision / recall plus the number of unjudged detections.
- Tests first: residual (static 0, constant pan 0, single jolt peaks), detection (threshold, grow, merge, max duration,
  continuous clip), subject filter (agreeing patches kept, disagreeing dropped, strong peak kept, low-texture fallback),
  jump distance, confidence rules incl. slow motion, momentMotion equals S1 `jitterScore` on the same shifts, migration,
  `motion` CLI with an injected frame source (curve stored, columns written, nudge applied to unprotected only, protected
  untouched), JSON shapes, drawer pure helper (marks inside the visible range).
- Done when: typecheck + test:all green; planner runs `motion --force` on Arrifana: run time, band counts vs S1
  (19 / 75 / 73; ≤ 5 % changed [D-4]), eval P ≥ 0.80 / R ≥ 0.88 (prototype 0.83 / 0.93), drawer checked in the browser.

**W1 result (2026-11-25):** ✅ w1-shakes (1177 tests after merging main). `src/core/motion/curve.ts` (port of the prototype),
migration 023 (`motion_curves`, `shakes`), `motion` measures whole clips once and derives moment values from the stored
curve (trims need no decode), `shakes` on `moments list` / `cut show`, drawer ticks + lines, `npm run eval:shakes`.
Implementer decisions (review): [D-17] the boundary nudge uses **high-confidence** shakes only; verdict fixture stores
`{verdict, end}`; old S1 per-moment code (`globalShift`, `measureFrames`) left as dead code (cleanup later). Planner run on
Arrifana (backup `clippilot.pre-023.db`): 100 clips in 10.8 min, 0 failed; 113 shakes (64 high / 49 low); bands 19 / 76 / 72
vs S1 19 / 75 / 73 (1 of 167 changed; per-moment jitter differs most where S1's ±8 px search saturated, p95 Δ 0.66);
eval P 0.83 / R 0.92 (2 new unjudged); 6 unprotected moments nudged (ends moved 0.07–0.5 s). Drawer checked in the browser
(C0513: ticks at 0.5 / 1.1 s, "Shake 0:00.5 · jump 1 % (46 px)"). Panel drawer shows the ticks, the text lines only in the
moment drawer.

**D1 — draft rules + board icon (planner spec, 2026-11-25; after W1)** — PRD 2b.3.
- `cut apply` result gains `warnings: [{panel (scene/panel index), moment_id, type, message, alternatives?: [moment ids]}]`
  per [D-7]; pure `draftWarnings(draft, moments, brief)` with tests (calmer alternative in dup group, ★ / must-have kept,
  too long, speech / action exemption up to 20 s, no warnings for user-placed panels in replace mode).
- `cut_out: [from, to]` on a draft panel and CLI `moment cut-out <id> <from> <to> [--ai]` [D-8]: validated (inside the
  moment, both parts ≥ 1 s); trims the moment, creates the sibling moment (migration: `highlights.split_of`), inserts the
  following panel(s); one undo step; undo restores both. Tests incl. undo.
- `--ai` on `moment trim | speed | cut-out` [D-9]: edit without confirming; the moment must stay unprotected under **both**
  `HighlightRepository.findUnprotected` and `protectionReasons` (C1): an `--ai` trim moves the ai range along (as
  `snapUnprotected` does); an `--ai` speed change must not count as "speed changed" (e.g. record the AI speed next to the
  moment) — a later user edit (no `--ai`) protects it as today. Tests for all three verbs, incl. undo.
- Tile icon [D-6] in `MomentTile` (pure helper `shakeHint(moment)` tested); drawer lists jitter + shakes (from W1).
- SKILL.md drafting rules: read `jitter` + `shakes`; avoid `shaky`; for a shake inside a good moment decide keep vs
  `cut_out`; B-roll cover only as a suggestion in chat; name `shaky_kept` warnings in the draft summary; action moments up
  to ~20 s, static/silent ≤ 8 s.

**D1 result (2026-11-25):** ✅ (1232 tests after merging main). Migration 024 (`highlights.split_of`, `highlights.ai_speed`);
`--ai` on `moment trim | speed | cut-out` and `panel place` (no confirm, ai range / ai speed move along, refused on
protected targets); `moment cut-out` + draft `cut_out` (sibling moment, one undo step; undo of a draft now restores every
moment it changed); `cut apply` → `warnings` (`shaky_alternative`, `shaky_kept`, `too_long`); tile icon "≈" (neutral) for
shaky / high-confidence shake; SKILL.md drafting rules. Implementer decisions (review) [D-19]: a draft `speed` on an AI
moment also records `ai_speed` (else it became protected); "★" for `shaky_kept` = effective tier hero (AI or user), so
AI-hero shaky moments without an alternative warn as kept; action = role action OR change ≥ 0.03 OR camera ≥ 2 %/s;
the sibling has no dup group. Planner check: Arrifana DB migrated (backup `clippilot.pre-024.db`), board shows "≈" on 19
tiles (title "Shaky · Jitter shaky · 0.55 %").

**C1 — critic plumbing + cut critic context (planner spec, 2026-11-25; parallel to W1)** — PRD 2b.4/2b.6 code part.
- Findings schema (Zod, `src/core/critic/findings.ts`) per [D-12]; `clippilot critic save --file f.json [--json]` validates
  (ids must exist in the cut; protected flag recomputed from the DB, never trusted from the file) and stores it;
  `critic list [--cut] --json`, `critic show <file|latest> --json`, `critic resolve <file> <finding id>
  applied|skipped|protected [--note]`, `critic summary [--cut] --json` (per round: counts by severity and resolution, plus
  the applied changes as one line each).
- `clippilot critic context [--cut id] --out <dir> --json`: brief + per panel (scene name / event, position, intent, state,
  moment: range, speed, played duration, tier / shot / role, description, speech + speech_cut, jitter, shakes (when W1 is
  in; tolerate absence), motion camera / change, audio_keep, protected + why, dup-group alternatives + candidate ids, prev /
  next panel ids) and one still strip PNG per panel: frames every 0.5 s of the played range + the exact last frame, from
  the proxy, labelled with the time, composited with `sharp` (max 12 frames per strip; longer panels sample evenly + last).
  Tests: context JSON from a fixture DB, strip timestamps (pure), protected reasons, strip rendering on a tiny generated clip.
- Story preview (for C2): `src/core/critic/preview.ts` builds an ffmpeg filter graph from the cut (trim, speed via setpts /
  atempo, keep-audio full volume, others −18 dB, burned label "S<scene>·P<panel>") → 480p H.264/AAC; pure graph builder
  tested, one integration test on generated media.
- `clippilot critic story [--cut id] [--yes] [--json]` [D-11]: renders the preview, estimates cost (pure, tested); without
  `--yes` prints `{estimate_usd, duration_sec, preview}` and exits 2; with `--yes` uploads (Files API, as analyze does for
  big proxies) to `story_critic_model` (default `gemini-2.5-pro`) with a prompt (brief, panel table with labels/ids/intents,
  rules: what to look for — pacing, order, scene membership, repetition, ending, too-long holds, cut-off speech — and the
  findings JSON format), validates with the same schema (retry malformed JSON up to 3×, like analyze), saves it as critic
  `story`. Gemini client injectable; tests with a fake client.

**C1 result (2026-11-25):** ✅ 3a08c4e (1110 tests). `clippilot critic save|list|show|resolve|summary|context|story`;
`src/core/critic/{findings,context,strips,preview,story-critic}.ts`. Implementer decisions (review): protected = confirmed /
rejected / trimmed / speed changed / ★ or a user-placed panel (not "used by a panel"); reviews in `.clippilot/reviews/`
with `resolutions` per finding; strips sample the source range (labels = clip time), last frame = end − 1 frame; preview
labels are sharp PNG overlays (local ffmpeg has no drawtext), 854×480 letterboxed, 25 fps, `.clippilot/previews/cut-<id>.mp4`;
`critic story --round n`; cost estimate adds the > 200 k token price tier. Planner check on Arrifana: `critic context` 37
panels in 57 s, strips correct (3 protected). Deferred: 429/503 backoff for the story call, chunked preview for 100+
panels, prices in config. Open (→ D1): an `--ai` trim must keep the moment unprotected (move the ai range too).

**C1b result (2026-11-25):** ✅ (1130 tests). `gemini-2.5-pro` returned 404 "no longer available to new users" → default
`story_critic_model` = `gemini-3.1-pro-preview` [D-11 updated]; prices $2 / $12 per M (≤ 200 k), $4 / $18 above (third-party
price lists, Google page not confirmed); 404 error names the model + config key. Finding proposals are structured and
validated per kind (string proposals in old files read as `{note}`); the story prompt gives clip in/out, speed, preview
start and speech per panel. [D-16] Planner made 3 paid story-critic runs on Arrifana "Main" (≈ $0.45 total; 1 failed on the
404): 168 s preview, 53 k input tokens, ~87 s per run. The real run found the user's own case (panel 54 belongs to the cliff
scene, `move_scene` to scene 6) plus repetitions and cut-off speech; findings only, nothing applied.

**C1c result (2026-11-25):** ✅ (1182 tests). After a cut-critic trial run on Arrifana "Main" (sonnet sub-agent, 3.5 min, 15
findings: 2 must / 11 should / 2 nit, 3 protected, all strips read; its feedback: no sentence times, no fps, alternatives
always empty, band meanings unclear) `critic context` now carries per moment `clip_fps`, `clip_event`, `slowmo`,
`suggested_speed`, `sentences` (±3 s, exact clip times), `alternatives` (similar + dup group, not in the cut, with jitter
band + high-shake count) and a strip `note` for the intentionally dropped still; the cut-critic skill was updated to match.

**C2 — critic agents + review loop skill (planner, 2026-11-25; after C1 + D1)** — written by the planner (prompts/skills,
no production code): `.claude/agents/cut-critic.md` [D-10], `.claude/skills/cut-critic/SKILL.md` (rules: static ≈ 2–3 s,
speech / clear action longer; cut-off sentences; shakes / shaky moments with calmer alternatives; last panel of a scene
holding a static image; clip belonging to the neighbouring scene's event; repetition of near-identical shots; every
proposal concrete: new in/out, replacement moment id, target scene), and a "Review loop" section in the clippilot skill
[D-13]: steps, cost OK, `--ai` edits, `critic resolve`, change list format.

**C2 result (2026-11-25):** ✅ `.claude/agents/cut-critic.md` (sonnet), `.claude/skills/cut-critic/SKILL.md`,
`.claude/skills/review-loop/SKILL.md`; cut-critic skill revised after the trial run.

**A1 — acceptance prep ✅ (2026-11-25)** [D-14]: cut **"Acceptance" (id 2)** in `~/Video/ClipPilot Arrifana` = "Main" + 9 seeded
faults + the user's 2 real cases (42 panels, 235.7 s vs target 165 s). Key (don't read before the test):
`~/Video/ClipPilot Arrifana/.clippilot/reviews/acceptance-key.md`.

**Loop dry run + C1d (2026-11-25):** one full loop round (sonnet sub-agent doing the cut critic inline + story critic,
≈ $0.20) on a **copy** of the DB, cut "Acceptance": 30 findings, 20 changes applied, 235.7 → 172.0 s (target 165), no
command failed; the real DB was not touched. Problems found and fixed: commands default to cut "Main" → skills always
pass the cut id; `panel move` is 0-based vs 1-based findings → `critic show` adds `cli_position`; summary labels drifted
after moves → labels stored at save time, merged findings shown once (`distinct_changes`); must-haves → `brief_check`
in `critic context`; rules for conflicting findings across critics written into the review-loop skill. C1d ✅ (1238 tests).

**F1 — shake fit: trim/split around shakes, AI check, mark (user decision 2026-11-25, planner spec)** — replaces the W1
boundary nudge. Why (user, after the dry run): the kiss (moment 241, 7.0–10.0 s) still contains a shake at 8.02–8.14 s;
whether a shake gets fixed must not depend on an LLM critic noticing it. Decisions (user): **all shakes** (high and low
confidence) count; **Gemini Flash** verifies; applies to **every unprotected AI moment**, also ones placed in a cut.
Steps per moment (after `motion` has detected the clip's shakes):
1. **Plan (pure, deterministic)** `planShakeFix(range, shakes, sentences)`: clean parts = range minus every overlapping
   shake (shake bounds ± 1 frame); parts < 1.0 s are dropped. No overlap → `clean`. One part ≥ 2 s → `trim` to it.
   Several parts ≥ 1.0 s with total ≥ 2 s → `split` (first part stays the moment, the others become sibling AI moments
   with `split_of`, as D1 `cut-out`). Nothing usable (total < 2 s) → `kept` ("no clean range"). A plan that would newly
   cut a sentence → `kept` ("speech").
2. **Verify (Gemini Flash, `gemini_model`)** only for `trim` / `split` plans: inline proxy segment of the original range
   (± 0.5 s), the moment's description, the shake times and the proposed part(s); Zod answer `{keeps_content: boolean,
   reason: string}` (retry malformed 3×). The question: does the edited version still contain the moment's key action
   complete — or does the key action happen during a removed shake (e.g. the kiss at the shake)?
3. **Apply or mark:** yes → apply (trim via `snapUnprotected`, split via the D1 cut-out path with `ai`: panels using the
   moment get the sibling panel(s) right behind) → `shake_status = 'fixed'`; no → range unchanged, `shake_status =
   'kept'`, `shake_note` = Gemini's reason. Protected moments: never changed; marked `kept` ("protected") when they contain
   a shake. Moments without shakes: `clean`.
- Storage: migration 025 `highlights.shake_status TEXT` (null = not checked | clean | fixed | kept), `shake_note TEXT`,
  `shake_checked_start/_end REAL` (range that was checked; a changed range → checked again next run, no repeat Gemini call
  for an unchanged range).
- Where it runs: `clippilot shakes fix [--project] [--cut <id>] [--dry-run] [--json]` (dry run = plans only, no Gemini
  call, no writes; JSON: per moment status, plan, verdict, reason; totals + Gemini calls); `motion` (and so `analyze`)
  runs it after detection instead of the old nudge (remove `nudgeClip`/`nudgeRange`). The review-loop and drafting
  skills run `shakes fix` after `cut apply` and after each loop round (AI range edits can create new overlaps).
- Undo: one history step "Shake fix (n moments)" per cut that uses a changed moment (snapshot covers those moments,
  siblings and panels), so the board can undo it.
- Output: `shake_status` + `shake_note` on `moments list` / `cut show` moments and `critic context`; drawer line
  "Shake kept — <note>" / "Shake trimmed out"; tile "≈" stays for `kept` and for shaky jitter.
- Tests first: planner (no shake, shake at start → trim, at end → trim, middle → split, two shakes → 3 parts / drop tiny
  parts, total < 2 s → kept, new speech cut → kept, low + high both count), verifier with a fake client (yes → applied,
  no → kept with note, malformed → retry), split creates sibling moments + panels in every cut using the moment,
  protected untouched but marked, idempotent re-run (no second Gemini call), changed range re-checked, undo restores
  moments + panels, dry run writes nothing.
- Done when: typecheck + test:all green; planner runs `shakes fix --dry-run` then the real run on Arrifana (backup first;
  42 of 167 moments contain shakes; ≈ $0.02) and checks the kiss (241) plus 5 fixed and 5 kept moments on the stills.

**F1 result (2026-11-25):** ✅ (1278 tests). `src/core/shakes/{plan,verify,state,index}.ts`, migration 025, `clippilot shakes
fix`, runs in `motion` / `analyze` (old nudge removed), `splitMoment` for 2+ parts, one undo step per affected cut,
`shake_status` / `shake_note` everywhere (moments, cut show, critic context, drawer). User decision during review: **no
2 s minimum for shake-fit parts** — only "clean part ≥ 1.0 s" (and the user is considering dropping the general 2 s / 8 s
moment rules entirely → open question). Real run on Arrifana (backup `clippilot.pre-025.db`): 167 checked, 121 clean,
**28 fixed** (16 trims, 12 splits → 12 new sibling moments), **18 kept** (11 "would cut a sentence", 2 "no clean range",
5 by Gemini), 33 Gemini Flash calls, 2:53. Kiss check on stills: moment 241's kiss is at 8.8–9.8 s, after the shake
(8.02–8.14) — the trim 8.18–10.0 would keep it, but Gemini kept the range because the description's line "Schön hier!"
lies before the shake — user decision: keep it, Gemini judges speech + action ("it will never be perfect"); moment 243 — the kiss happens during the
shake → kept, correct. Implementer notes: undo of one cut's step also removes sibling panels in other cuts.

**Acceptance loop run (2026-11-25, planner, user-approved ≈ $0.40):** 3 rounds on cut "Acceptance" (id 2, renamed "Main"
for board viewing; the original is "Main (original)"): 31 changes, 230.4 → 153.6 s (target 165); both real cases fixed
(R1 moved to the cliffs in round 2, R2 aerial trimmed in round 3); 3 story-critic removals skipped for length (cut would
have been ~142 s); findings for the user live only in `.clippilot/reviews/*.json` / CLI (→ open: show them on the board).

**B1 — false protection by draft speed (bug, planner spec 2026-11-25).** Three boat moments (293, 312, 317) count as
protected ("speed") although only Claude's first draft (2026-11-22, before `ai_speed` existed) set them from Gemini's
suggested 0.5× to 1×. Every user edit confirms the moment, so a speed change on a moment that is still `proposed` can only
come from the AI. Migration 026: `UPDATE highlights SET ai_speed = speed WHERE status = 'proposed' AND ai_speed IS NULL`
for rows whose speed differs from `defaultSpeed(suggested_speed, clip fps)` (do it in TS with the existing helper). Tests:
migration backfills only proposed moments with a changed speed; confirmed / rejected / unchanged untouched; afterwards
`protectionReasons` is empty for such a moment. Done when green and the 3 boat moments are unprotected on Arrifana.

**B1 result (2026-11-25):** ✅ migration 026 (1279 tests). Arrifana migrated (backup `clippilot.pre-026.db`): 6 moments got
`ai_speed`; the 3 boat moments (293, 312, 317) are no longer protected (their findings were not applied — user decision).

**A2 — shake- and speech-aware analysis (user decision 2026-11-25, planner spec).** Today Gemini picks moments blind and
the shake fit / transcript snap repair them afterwards. New order inside `analyze` for the clips being analysed:
1. transcribe (when the whisper model exists; unchanged code), 2. measure motion curves + detect shakes (W1 code, no moments
needed yet), 3. Gemini analysis with a **measured-context block** in the prompt, 4. normaliser as today (clamp, 2–8 s,
speech snap), 5. shake fit (F1) as the safety net.
- Context block per clip (pure builder, tested), only the parts that exist:
  - "Camera jolts (measured): 4.74–4.94 s (strong), 8.02–8.14 s (weak) …" (strong = high confidence), plus the clip's
    handheld jitter in words when the clip is continuously shaky.
  - "Spoken (transcript): [3.1–7.8 s] "1, 2, 3, 4, 5, 9." …" — sentences with times, max ~1500 characters (cut evenly, say so).
- Instructions (prompt text, keep it short, in the prompt's language): moment boundaries never inside a jolt or a
  sentence; prefer ranges without a jolt inside; if the moment's key action happens during a jolt, keep the moment and set
  `jolt_at_key_action: true`.
- Schema: new optional boolean `jolt_at_key_action` per moment (default false) → stored (migration 027
  `highlights.jolt_at_key_action INTEGER DEFAULT 0`) and on moment JSON.
- Shake fit: a moment with `jolt_at_key_action` that overlaps a shake is marked `kept` with note "Key action at the jolt
  (analysis)" **without** a verify call; everything else as F1.
- Prompt version: bump whatever identifies the analysis prompt; clips analysed before keep their data.
- Without whisper model / when motion fails for a clip: the block omits that part; analysis still runs.
- Tests first: block builder (jolts only, speech only, both, none, truncation), analyze order with injected fakes
  (transcribe and motion run before the Gemini call and the prompt contains the block), schema accepts / defaults the flag,
  flag → kept without verify, regression: existing analyze tests still pass.
- Done when typecheck + test:all green; planner test run **from scratch** on Praia do Odeceixe (13 clips) in a new project
  `~/Video/ClipPilot Odeceixe` and compares with the Odeceixe moments in the Arrifana project (old prompt): moments with a
  shake inside before the fit, fit actions (fixed / kept / Gemini calls), sentence cuts, total cost.

**A2 result (2026-11-25):** ✅ (1300 tests). `analyze` order: transcribe → motion (also clips without moments) → Gemini with a
German "Gemessene Daten" block (jolts strong/weak, continuous shake, timed sentences ≤ 1500 chars) → normaliser → shake fit;
schema flag `jolt_at_key_action` (migration 027) → shake fit keeps such moments without a verify call;
`ANALYSIS_PROMPT_VERSION = 2` (constant only). From-scratch test: new project `~/Video/ClipPilot Odeceixe` (13 clips;
ingest 2 min, analyze 3.5 min, 13 + 6 Gemini Flash calls, a few cents). vs the same clips in Arrifana (old prompt): 19 vs 21
moments; shakes in the middle of a moment 0 vs 3 (no splits / jump cuts); shake only at a boundary 6 vs 0 (Gemini cuts at
the jolt but ±0.2 s → fit trims ≤ 0.2 s); kept 0 vs 1; sentence cuts 0 vs 4. Found on the way: **`ingest` does not run
`analyze` automatically** although `--skip-analysis` and the skill say so (deferred fix).

**W2 — zoom-aware subject-motion filter (user report + planner spec, 2026-11-25).** Scene 5 panel 1 of "Acceptance"
(C0611, moment 325, 3.0–7.4 s) still shows a shake at its end: 7.08–7.44 s jolts (all patches agree), 7.56–7.84 s a fast
zoom (border patches move apart radially, up to ±17 px = beyond the ±16 px search), 7.96–8.32 s jolts. The W1 filter
compares patches with their *median shift*, so the zoom reads as subject motion (disagreement 0.88 ≥ 0.5) and the whole
1.3 s candidate is dropped — although the user had judged exactly this candidate (93@7.06) "yes".
Fix: per frame, fit a **similarity camera model** (shift tx, ty + zoom s + rotation r; least squares) to the textured
border patches' shake residual vectors (patch centres: x 0.16 / 0.5 / 0.84, y 0.215 / 0.785, middle row 0.5; y scaled by
the frame's aspect); disagreement = Σ median |patch residual − model prediction| ÷ Σ mean |prediction| over the candidate.
Keep when disagreement < **0.4** or peak ≥ 60 %/s. Prototype (`exports/wackler-eval/eval_sim.py` on `all4.json`): P 0.83 /
R 0.93 — same as the W1 rule — and 93@7.06 goes from 0.88 (dropped) to 0.24 (kept).
- Change `src/core/motion/curve.ts` (subject filter / disagreement) only; stored `disagreement` = the new value; ≥ 4
  textured patches for the fit (else all 8); no new dependency (2×4 normal equations by hand).
- Tests first: uniform shift → ≈ 0; pure zoom (radial pattern) → ≈ 0 (kept); zoom + shift → ≈ 0; one patch off (subject)
  → high (dropped); rotation → ≈ 0; low-texture fallback; existing W1 tests still green (update thresholds only where the
  spec changes them).
- Done when green; planner re-measures Arrifana (`motion --force`, backup), runs the shake fit, `eval:shakes` ≥ 0.80 / 0.88,
  and checks panel 1 of scene 5.

**W2 result (2026-11-25):** ✅ (1307 tests). Similarity fit in `curve.ts` (`fitSimilarity`, threshold 0.4, ≥ 4 textured
patches). Arrifana re-measured (backup `clippilot.pre-w2.db`, 100 clips, 11.5 min): 114 shakes (was 113; the new one is
C0611 7.06–8.26 s, high, disagreement 0.24); eval P 0.83 / R 0.92 (unchanged); shake fit re-run: 179 checked, 4 fixed,
14 kept, 7 Gemini calls — scene 5 panel 1 (moment 325) now ends at 7.02 s, before the jolt.

**P2 — frame-exact moment end in the board players (user report + planner spec, 2026-11-25).** Scene 5 panel 1 still showed
the start of a jolt "at the very end" although the moment ends at 7.02 s and the shake starts at 7.06 s: the board players
check the end only on `timeupdate` (every ~0.25 s), so playback overshoots the moment's end by up to ~0.25 s — exactly into
the jolt that the shake fit trimmed away. Export (Resolve) is frame-exact; only the preview lies.
- One shared mechanism for all board players that loop or advance at a moment's end — `VideoThumb` (tile hover),
  `DrawerPlayer` (drawer loop, `loopSeekTarget`), `PreviewModal` (scene / cut preview, next panel): check the time on every
  presented frame with `video.requestVideoFrameCallback` (Safari ≥ 15.4, Chrome), fallback `requestAnimationFrame`; act
  when `mediaTime + one frame ≥ end` (frame duration from the clip fps, default 1/25) so the last shown frame is before the
  end; keep the existing Safari rule "read currentTime once".
- Pure helper (tested): `frameEndReached(mediaTime, end, frameSec)` and the loop/advance decision built on the existing
  `loopStep` / `loopSeekTarget` semantics (free mode, a − 0.3 rule) unchanged.
- Tests first for the pure parts; component wiring checked by the planner in the browser (sample `currentTime` at each
  loop: max overshoot past the end ≤ 1 frame).

**P2 + P3 result (2026-11-25):** ✅ (1314 tests). P2: `web/src/board/frameWatch.ts` (`requestVideoFrameCallback`, rAF
fallback; loop / advance at the last frame before the end) used by `VideoThumb`, `DrawerPlayer`, `PreviewModal`; checked by
the user in Safari (scene 5 panel 1 no longer shows the jolt). P3 (user decision): **unseen** moments are greyed out, seen
ones in colour (`fades()` in `pool.ts`); legend "not seen yet".

**How to run the acceptance test (user)**
1. Review the decisions [D-1]…[D-19] above (and the implementer decisions in the W1 / C1 / C1b / D1 results).
2. `cd ~/dev/clippilot && npm run skill:install` (installs the clippilot, cut-critic, review-loop skills and the cut-critic
   agent globally — needed when the session runs outside this repo).
3. In a Claude Code session in `~/Video/ClipPilot Arrifana`: "Run the review loop on the cut Acceptance". Claude shows the
   story-critic cost (≈ $0.15 per run, 2 runs) and waits for your OK; then up to 3 rounds; change list in chat.
4. Look at the board (cut "Acceptance"; every change is one undo step) and score against the key: ≥ 8 of 11 found, few
   false alarms (PRD 2b.7).
5. To reset and re-run: copy `.clippilot/clippilot.acceptance-start.db` over `.clippilot/clippilot.db` (board closed; also
   delete `clippilot.db-wal` / `-shm`). That is the state right before the test (Acceptance seeded, all migrations).
   `clippilot.pre-acceptance.db` = before the Acceptance cut existed.

- Also open (no decision needed): the "locked" band is misleading until light-jitter calibration — treat Arrifana as all
  handheld (resolve-prep marks every non-shaky clip orange anyway in practice: 5 locked panels are really handheld);
  `clippilot` skill changes (transcribe/speech) not installed globally (`npm run skill:install` = the user's call);
  review pages `exports/shake-review.html` + `exports/wackler-review.html` open only in **Chrome** (Safari blocks local
  video from file:// pages).
