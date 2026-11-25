# Board fixes (BF1–BF2)

Two small fixes found while using the board on Odeceixe/Arrifana. Both are independent.

## BF1 — cut picker on the board

**Problem:** `useBoard` always opens the project's cut "Main" (resolved or created). Other cuts (e.g. review-loop
drafts) cannot be viewed on the board.

**Behaviour**
- The toolbar breadcrumb "03 Arrifana › Main" becomes "03 Arrifana › [Main ▾]": a small, calm picker (native
  `<select>`, existing `bd-*` tokens) listing the project's cuts by name. Plain text when the project has only one cut.
- Choosing a cut loads it: tree, moment pool and undo history reset; scene selection and open drawer reset.
- The chosen cut is kept in the URL as query param `?cut=<cut id>` (via `history.replaceState`, other params kept), so a
  reload keeps it. Choosing "Main" removes the param.
- Resolution (pure): param is a valid id of one of the project's cuts → that cut; otherwise (no param, junk, id from
  another project) → the cut named "Main"; if none exists → create "Main" as today.
- Out of scope: creating, renaming, deleting cuts.

**Tests first** (`tests/unit/web/board-cuts.test.ts`, pure parts only)
- `resolveCut(cuts, param)`: valid id wins; no param → Main; unknown/junk id → Main; no Main and no param → `null`
  (caller creates Main); param valid even without Main.
- `cutParam(search)`: parses `?cut=7`, ignores junk/negative/empty.
- `searchWithCut(search, id, mainId)`: sets/replaces `cut`, drops it for Main, keeps other params.
- UI-only (not unit-tested): the picker in `BoardToolbar`, `replaceState` wiring, `useBoard` cut switching.

**Done when:** typecheck + test:all green; picker visible in the toolbar, switching cuts works and survives reload.

## BF2 — `ingest` runs `analyze`

**Problem:** `ingest --skip-analysis` says "Skip automatic analysis after ingest", but ingest never analyzes.

**Behaviour**
- After ingest (and event assignment), unless `--skip-analysis`, ingest runs the same analysis as `clippilot analyze`
  (transcribe, measure, Gemini, look fingerprints, dup groups, shake fit) on the **newly ingested clips only** (clip ids
  of the project after minus before). The analyze action body is extracted into a reusable function; ingest calls it —
  no duplicated pipeline.
- No new clips → nothing to analyze, no message.
- No Gemini key configured → ingest still succeeds (exit 0) and prints one line telling the user to run
  `clippilot analyze` later.
- `--skip-analysis` → analysis not invoked.
- Analysis failure does not fail the ingest: warning printed with the same "run analyze later" hint.

**Tests first** (`tests/unit/cli/ingest-analysis.test.ts`, fake runner, no Gemini/model)
- `analyzeAfterIngest` with new clip ids invokes the runner with exactly those ids.
- `skipAnalysis: true` → runner not called.
- No key → runner not called, one hint line, resolves.
- No new clips → runner not called, no output.
- Runner throws → resolves; warning + hint printed.

**Done when:** typecheck + test:all green.
