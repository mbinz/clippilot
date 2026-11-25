# Similar moments by look (SM1–SM4)

> Moved verbatim from STATUS.md (and PRD.md) on 2026-11-25. Old names ("roadmap item 2b", "M3", "below") refer to
> the former layout; the current todo list is in [STATUS.md](../STATUS.md).

### Similar moments by look (grilling 2026-11-25, rounds 1–4) — specs SM1–SM3, SM4 deferred

**Problem (user):** the board's "similar moments" look random — clearly different shots show up, near-identical takes
sit further down. Cause: similar = exact match on `event_id | role | shot` (`web/src/board/pool.ts` `similarKey`,
`service.ts` similar query), sorted ★ first then recording time. Gemini's role/shot labels are coarse (Odeceixe: 19
moments → 4 groups, largest 10) and miss retakes that got a different label; nothing measures how alike two shots look.

**Decisions**
- [SM-1] **Similar = same setup / retake**, judged by the look of the frames; never across events.
- [SM-2] **One meaning everywhere:** moment drawer list, panel options, pool groups, `slotFor`, draft/critic rules
  (`rules.ts` `shaky_alternative`), critic context alternatives, `selection.ts`. The label match (`similarKey`) goes.
- [SM-3] **Signal:** local **SigLIP base** image model via `@huggingface/transformers`, cached in `~/.clippilot/models`
  (first run downloads once, prints the size first). If > ~1 s per moment on the user's Mac → CLIP ViT-B/32, user told.
  Per moment: frames at 20 / 50 / 80 % of the moment from the proxy (software decode), each embedded, averaged,
  normalized = the moment's **look fingerprint** (internal name; never shown in the UI).
- [SM-4] **No new command.** `analyze` fills missing or stale fingerprints for already-analyzed clips **without calling
  Gemini**; a re-trimmed moment is stale (fingerprint range ≠ current range) and is redone on the next `analyze`.
  `analyze` prints how many moments still lack one.
- [SM-5] **Missing fingerprint → nothing similar, no fallback, no UI hint**: drawer section hidden, panel options show
  only the panel's own moment + candidates, pool shows it alone, `slotFor` only finds the panel using it, critic
  "calmer take" check skips it.
- [SM-6] **Score** = cosine similarity + a small recording-time boost (retakes are minutes apart). Role/shot labels and
  ★ are **not** part of it; ★ is a badge only. Lists are nearest first (a near-identical unstarred take beats a starred
  different shot).
- [SM-7] **Lists:** above one global threshold, nearest first; below it a collapsed "▸ Other moments in this event · N".
  **Groups:** average-linkage clustering per event with the same threshold (no union-find chaining: A≈B and B≈C must not
  pull A and C together). A moment's drawer list always contains its group members (plus anything else above the line),
  so pool groups and drawer lists never disagree.
- [SM-8] **(revised 2026-11-25, user: "only show actual stars")** The ★ section holds starred moments only, in one row by recording
  time (not grouped); unstarred members of a starred group go down to the rest. Old rule, kept for history: **Pool:** a group with any ★ sits in the ★ section, starred takes first, then recording time; groups ordered
  by earliest recording time as today.
- [SM-9] **Tuning by eye:** tests use synthetic vectors only (no golden fixture). Threshold + time boost are constants in
  one file; the user checks Odeceixe on the board and says "X should / shouldn't be with Y", the planner adjusts. No
  scores or debug info in the UI.
- [SM-10] The old clip-level similarity (`src/core/similarity/` union-find, `/similarity` routes, `SimilarityView`,
  ClipDetail "Find similar", `clippilot similar`, `clip_similarity_*` tables) is retired in SM4 (deferred, separate slice).

**SM1 — look fingerprints in `analyze`.**
- Migration (next free number; L1 may claim one first): `highlights.look_vec BLOB` (Float32, normalized),
  `look_model TEXT`, `look_start_sec REAL`, `look_end_sec REAL` (range it was computed for → stale check).
- `src/core/look/`: frame times (pure), frame grab from the proxy (ffmpeg, software decode), embedder behind a small
  interface (real = transformers SigLIP; tests = fake), average + normalize (pure).
- `analyze`: after the Gemini step for new clips; for `done` clips fills missing/stale fingerprints only (no Gemini
  call, no `--force` needed). Summary line: "look fingerprints: N new, M stale redone, K missing". Moments created later
  (cut-out split, `insertMoment`) have none until the next `analyze` — fine per SM-5.
- Tests first: frame times; average/normalize; stale rule; analyze fills only missing/stale and never calls Gemini for
  done clips (fake embedder + fake Gemini); migration.
- Done when typecheck + test:all green; run on `~/Video/ClipPilot Odeceixe` (and Arrifana) with time per moment printed.
- **Result (2026-11-25):** done on Odeceixe with SigLIP base (`Xenova/siglip-base-patch16-224`, 768-d): 19 new, 0 stale, 0 missing, 0.25 s per moment (software decode); pairwise cosine min/median/max 0.52/0.70/0.99. Migration 028. Arrifana not run.

**SM2 — ranking in the drawers.**
- `src/core/look/similar.ts` (pure): `score(a, b)` (cosine + time boost), `similarTo(moment, moments)` → same event,
  both fingerprinted, not out; nearest first, split at `LOOK_THRESHOLD`. Constants `LOOK_THRESHOLD`, `TIME_BOOST`,
  `TIME_BOOST_WINDOW_SEC` live here (start values picked from Odeceixe score spread, then tuned by SM-9).
- Server computes per moment `similar_ids` (above the line, nearest first) and sends it with the board's moments (no
  vectors to the browser: Portugal ≈ 1400 moments × 768 floats). `service.ts` similar-moments query uses it too.
- Web: `alternatives()` = `similar_ids`; MomentDrawer "Similar moments · N" nearest first + collapsed "Other moments in
  this event · N" (by time); PanelDrawer `optionList`: current, similar, collapsed others. Missing fingerprint → hidden.
- Tests first: ranking/threshold/event-only/out-excluded/missing → empty on synthetic vectors; `optionList` +
  `alternatives` with `similar_ids`. Browser check on Odeceixe by the planner, then the user's feedback round.
- **Result (2026-11-25):** done. `LOOK_THRESHOLD` 0.80, `TIME_BOOST` 0.05, `TIME_BOOST_WINDOW_SEC` 300 (Odeceixe: ~5 similar per moment, 48 of 171 pairs above the line); `similar_ids` on `GET /projects/:id/moments`; `StoryboardService.alternatives`/`similarIds` (so critic context + board selection follow, label match still in `poolOrder`/`slotFor`/`rules.ts` until SM3). Similar section is open (hidden when empty), "Other moments in this event" collapsed. Visual check pending (user).

**SM3 — look groups everywhere.**
- Pure average-linkage clustering per event at `LOOK_THRESHOLD` → `look_group` per moment (null = alone / no
  fingerprint); `similar_ids` ∪= group members (SM-7).
- `poolOrder` groups by `look_group` with the ★ rule (SM-8); `slotFor`, `rules.ts` `shaky_alternative`,
  `critic/context.ts` alternatives, `storyboard/selection.ts` similar ids all switch; `similarKey` removed.
- Tests first: no chaining (A≈B, B≈C, A≉C → A and C apart); deterministic order; ★ section rule; `slotFor`;
  `shaky_alternative` with/without fingerprints.
- **Result (2026-11-25):** done. `lookGroups` in `look/similar.ts` (group id = smallest member id); `look_group` on `listMoments`/`/moments`/`cut moments`; `similar_ids` ∪= group members; web `poolOrder`/`slotFor` by `look_group` (★ group rule), `rules.ts` `shaky_alternative` uses `look_group`, `similarKey` gone. Arrifana (180 moments): 23 groups, largest 23 of 66 (Delfine); at 0.80 groups run large, tune by eye (SM-9).

**SM4 (deferred) — retire the old clip similarity** per SM-10, incl. a migration dropping `clip_similarity_*`, the
SKILL/instructions mention of `similar` / `mark-best`, and the ARCHITECTURE "Query" line.

**Tuning round 1 (2026-11-25):** ★ section = stars only (SM-8 revised); `LOOK_THRESHOLD` 0.80 → 0.85.
