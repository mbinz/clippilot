# ClipPilot — Status

One screen: where we are, what's next. Specs live in [docs/specs/](docs/specs/), the dated log and finished
milestones in [docs/history.md](docs/history.md). Roadmap themes (the "why") in [PRD.md](PRD.md#roadmap).

**Naming:** work is grouped by **theme** (plain name). Slices inside a theme get a short code (SM1, L1, …); the code's
letters belong to that theme. Old codes (M3, "roadmap item 2b", T1, W1, …) only appear in history and done specs.

## State (2026-11-25)

v0.3 in use on the Arrifana cut (Safari). Draft quality is built: transcript, jitter + shakes, draft rules, cut critic,
story critic, review loop (1314 tests). Post-production tools (`resolve-prep`) live in `~/dev/clippilot-post`.
Projects: `~/Video/ClipPilot Arrifana` (main test cut), `~/Video/ClipPilot Odeceixe` (analysed, no brief yet),
`~/Video/Portugal` (full trip, not ingested yet).

## Todo

Order agreed 2026-11-25. Each line: theme — what — spec.

### Now
- [x] **Similar moments** SM1 look fingerprints in `analyze` (SigLIP, 0.24 s/moment) + SM2 drawer ranking — done
  2026-11-25; Arrifana (180) + Odeceixe (19) fingerprinted
- [x] **Similar moments** SM3 look groups everywhere (pool, `slotFor`, draft rule, critic) — done 2026-11-25;
  Arrifana: 23 groups, some large (Delfine 23 of 66) — [spec](docs/specs/similar-moments.md)
- [x] **Board fixes** BF1 cut picker (`?cut=`) + BF2 `ingest` runs `analyze` — done 2026-11-25 —
  [spec](docs/specs/board-fixes.md)

### Next
- [ ] **Board editing** — grilled 2026-11-26, build before Odeceixe: BE1 panel grid + drag/insert (done 2026-11-26) → BE2 panel view
  (two-up, done 2026-11-26) → BE3 pool "find what's missing" (≈ marks, ghost placement; no side drawer) → BE4 create a moment → BE5
  full-screen compare — [spec](docs/specs/board-editing.md)
- [ ] **Board fixes, part 3** — critic findings on the board (apply / dismiss), inside the BE2 panel view — grill
  first, no spec yet
- [x] **Learning from edits** L1 who made each edit (`operations.actor`, `--ai` on scene/panel verbs) — done 2026-11-25,
  ahead of L0 so this week's board edits are recorded
- [ ] **Learning from edits, part 1b** — L0 instructions in one folder. Note: skills aren't in the repo (only
  `~/.claude/skills/`), `npm run skill:install` points at missing paths — L0 fixes both — [spec](docs/specs/learning.md)
- [ ] **Odeceixe end to end** — brief → draft → review loop on `~/Video/ClipPilot Odeceixe`; first real test of
  similar moments
- [ ] **Learning from edits, part 2** — L2 `learn context` → L3 learning skill; first run on Odeceixe —
  [spec](docs/specs/learning.md)
- [ ] **Full Portugal** — ingest + analyze 508 clips (≈ $5–10, cost OK first), events, brief —
  [spec](docs/specs/analysis-polish.md) (Q4)

### Needs you
- [ ] Tune similar moments by eye (SM-9): drawers + pool groups on Arrifana, note "X should / shouldn't be with Y",
  groups too big? Round 1 done (★ = stars only, threshold 0.80 → 0.85). One knob: `LOOK_THRESHOLD` = 0.85 in `src/core/look/similar.ts`. Since SM3 a drawer list also holds
  the whole group (median 14 per moment); a ★ anywhere pulls the group into the ★ section (★ 9 → 43 on Arrifana)
- [ ] Score the acceptance run against `acceptance-key.md` (≥ 8 of 11 found, few false alarms) —
  [how](docs/specs/draft-quality.md) ("How to run the acceptance test")
- [ ] Decide: drop the general 2 s / 8 s moment-length rules?

### Later (roadmap order)
- [ ] Board: create / rename / delete cuts (BF1 only picks)
- [ ] **Mac app** — Electron shell, project picker, ingest/analyze from the UI; CI with packaging
- [ ] **Assistant in the board** — chat panel via the Agent SDK, acting through the CLI verbs
- [ ] **Gap fillers + plugins** — [spec](docs/specs/gap-fillers.md)
- [ ] **Phone review** — Mac as server via Tailscale

### Cleanup (any gap)
- [ ] Dead S1 motion code
- [ ] Retire the old clip similarity (SM4) — [spec](docs/specs/similar-moments.md)
- [ ] Light-jitter ("locked") calibration — deferred by the user; Arrifana counts as all handheld until then

## Proposals

Project proposals from the learning step (L3) land here; accepted ones become todos above.

_None yet._

## Done (themes)

Export to free Resolve · Understand the footage · Events · Storyboard model + CLI · Scene board (v0.2) · Board v3 +
assistant link (v0.3) · Analysis polish (Q1–Q3) · Post-production tools v0.1 · Draft quality (transcript, jitter,
shakes, draft rules, critics, review loop, acceptance loop run) — details in [docs/history.md](docs/history.md) and
[docs/specs/](docs/specs/).

## Deferred / future
- Clip tool (own page): one clip, its moments, edit tools + browser for clips the AI skipped — [board editing](docs/specs/board-editing.md#deferred)
- Look fingerprints aren't redone when `look_model` changes (stale rule is range only)
- objc warning: duplicate libvips (sharp + transformers.js) — harmless so far, watch for crashes
- Music-aware cutting (track per cut, length fitting, beat sync)
- Speed ramps within a segment
- VO script drafted from the storyboard
- Resolve Studio scripting adapter (open question — only if open formats can't be made reliable)
- AI model provider abstraction
- Open-source release + packaging (after v0.2 works on Portugal)

## Known gaps (non-milestone)

- **`thumbnail` repository, `gemini-client`, `proxy` modules** — production code present, no direct unit tests (proxy/thumbnail covered indirectly by the `ingest` integration test).
- **`projects` API route** — exists in `src/core/server/routes/projects.ts` but no test.
- **No packaging** — no `bin` build, no npm publish. Install via repo clone + `npm install -g tsx`.
- **No CI** — tests run only locally.
- **Story-AI** — sequence reasoning lives in Claude chat over `get-clip` results; no AI-generated sequence ordering in the app itself.

## How to make a change

1. **Baseline green:** `npm run typecheck && npm run test:all`
2. **Scope it** in Claude Code plan mode (no separate framework needed).
3. **Acceptance criterion = a test.** Add or adjust the `vitest` test that proves the change. If the change is UI-only and not unit-testable, say so explicitly in the commit message.
4. **Commit atomically** and update this file: tick the todo, add new todos, note deferred items. Slice specs go into
   the theme's file in `docs/specs/` (new theme → new file, linked from the todo); finished work gets a one-line result
   there. Git log + this file + `docs/` are the project memory.

That's the whole process. No `.planning/`, no `CHANGELOG.md`, no agent framework.
