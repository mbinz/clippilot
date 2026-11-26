# Board editing (BE1–BE5)

**Result (2026-11-26):** all five slices built and merged (1451 tests). Checked on a scratch copy of Arrifana in
the Chrome pane; Safari pass still open (STATUS). Extras: moment description edit (`PATCH /moments/:id`, `moment
describe`), migrations 030 `highlights.created_by` and 031 `highlights.ai_description`.

From UI feedback round 1 (2026-11-25, F1–F6 below) and the grilling rounds of 2026-11-26. Order: BE1 → BE5, each slice
merges on its own. "Board fixes, part 3" (critic findings) comes after BE5 and lands inside the panel view — own
grilling round first.

**Big picture**
- A scene's panels **wrap into rows** (storyboard grid); no sideways scroll. The right-hand side drawer is gone.
- Clicking a panel opens the **panel view**: a full-width area right under that panel's row, built around a **two-up**:
  left = what's in the panel, right = a candidate to replace it.
- The **pool** lists unused moments and answers "is something like this already in the story? where would it go?".
- There is **no clip view** on the board (a separate clip tool is deferred, see below).

**Holds everywhere**
- Every edit is one undo step via the existing routes (op log + `operations.actor` = user). No new edit path that
  bypasses `logged(...)`.
- One meaning per colour: neutral = selection, violet = AI proposal (dashed), green = yours, amber = needs a decision,
  red = rejected. New marks (≈) are neutral grey.
- Calm main view: tools only on hover or in the panel view.
- Below 900 px the panel view is a full-screen sheet (as the drawer is today).
- Safari is the target browser: read `video.currentTime` once per handler.
- UI-only parts are verified in the running board (`npm run dev`, Arrifana project); say "UI-only, not unit-tested" in
  the commit message for those parts.

## BE1 — Panel grid + drag / insert (F1, F2)

**Behaviour**
- `PanelStrip` becomes a wrapping grid (`flex-wrap`, panels keep 190 px width, gap as today). No `overflow-x-auto`.
  The `compact` prop goes away (no drawer pushes the board aside any more — until BE2 lands, the current drawer may stay
  as is; only the strip changes).
- **Insert slots:** between every two panels, before the first and after the last, there is a thin slot (≈ 12 px wide,
  full panel height). It shows a "＋" only on hover or while something is dragged over the grid.
  - Click slot at index *i* → new empty panel at position *i* (`POST /scenes/:id/panels {position}`).
  - Drop a pool moment on slot *i* → new filled panel at position *i* (`{position, moment_id}`).
  - Dropping a moment **on** a panel replaces its moment (as today). The "＋" tile at the end stays (click = empty panel
    at the end, drop = filled panel at the end).
- **Drag panels:** panels are `draggable`. The drag payload is distinguishable from a moment drag (e.g. MIME type
  `application/x-clippilot-panel` vs today's `text/plain` moment id).
  - Drop on slot *i* of the same scene → `POST /panels/:id/move {scene_id, position}` with the position corrected for
    the panel's own removal (see `moveTarget`). Dropping on its own neighbouring slots is a no-op (no request).
  - Drop on a scene in `SceneNav` → move to the end of that scene. The scene row highlights while dragged over.
  - Dropping a panel **on** a panel does nothing (no swap, no replace).
- The ◀ ▶ "move panel" buttons in the panel drawer go away.

**Tests first** (`tests/unit/web/board-grid.test.ts`, pure parts in `web/src/board/grid.ts`)
- `moveTarget(panelIds, draggedId, slotIndex)` → the `position` to send, or `null` for a no-op: moving forward
  subtracts one for the removed panel; slots right before/after the dragged panel → `null`; first/last slot work.
- `dragKind(types: readonly string[])` → `'panel' | 'moment' | null` from `DataTransfer.types`.
- UI-only: slot hover/drag visibility, drop highlighting, `SceneNav` drop target.

**Done when:** typecheck + test:all green; on Arrifana a scene with 10+ panels shows in rows without sideways scroll;
reorder, move to another scene, insert empty and insert-with-moment work and each is one undo step.

## BE2 — Panel view (F3, F4, F5)

Replaces `PanelDrawer` (and the drawer column for panels). `MomentDrawer` stays until BE3.

**Layout**
- Opening a panel inserts the panel view into the grid **after the last panel of the selected panel's row** (full grid
  width, rows below move down). Scroll it into view. `Esc` closes it.
- Two big players side by side, equal size, as large as the width allows (16:9). Left = the panel's moment, right = the
  candidate. Under the players: the **candidate row** (small tiles, hover plays as today).
- While a panel view is open the big pool below the grid is hidden; it returns on close.

**Candidates** (`candidateRow(panel, tree, moments)` — pure)
1. The panel's AI candidates (CHOOSE panel), in their order.
2. Similar moments of the panel's moment (`similar_ids`, nearest first).
3. Unused moments of the scene's event, ★ first, then by distance of their recording time to the panel's spot
   (the recording time of the panel's moment; for an empty panel the midpoint of its neighbours' times, else the
   scene's first time).
- Without duplicates, without the panel's own moment, without rejected moments / hidden clips. Moments used in other
   panels stay out of step 3 but may appear in steps 1–2 (marked "in panel N").
- The right player starts on the first candidate; clicking a tile or ←/→ sets the right player.

**Playback:** both players loop their own range and (re)start together when the right candidate changes. Sound from the
left; a small toggle switches sound to the right. Different lengths loop independently.

**States**
- Filled: left = panel moment (green/violet ring as in the grid), right = candidate. "Use this" under the right.
- CHOOSE: left = first AI candidate (dashed violet, "not decided"), right = the next candidate. Both sides show
  "Use this" while undecided.
- Empty: left = empty frame ("drop or pick a moment"; drop a moment there fills the panel), right = first candidate.
- "Use this" (button, `Enter`, or drag the right player onto the left) → `place` / `pick` as today; the panel becomes
  yours; the previous moment becomes the right-hand candidate (swap back is one more "Use this"). One undo step.

**Under the players**
- Left: the clip timeline (existing `ClipTimeline`) with trim handles for the panel's moment; speed; intent (inline
  edit); delete panel; ★ / ✕ / seen; ⋯ menu (hide clip, show in Finder).
- Right: the candidate's clip timeline (marks only, no trim yet — trim on the right comes with BE4), ★ / ✕ / seen, ⋯.
- Timelines mark the clip's other moments (click one → it becomes the right-hand candidate) and moments already in the
  story (a neutral tick).

**Keys** (only while a panel view is open, not while typing in an input): ←/→ candidate, `Enter` use this, `Esc` close,
`Tab` / `Shift+Tab` next/previous panel (across scenes in cut order) without closing, `N` next to choose (as today).
`F` is reserved for BE5.

**Tests first** (`tests/unit/web/board-panelview.test.ts`, pure parts in `web/src/board/panelview.ts`)
- `candidateRow`: order of the three groups; no duplicates; excludes own/rejected/hidden; empty panel uses neighbour
  midpoint; CHOOSE panel puts candidates first and left = first candidate.
- `rowEnd(panelIndex, perRow, count)` → index after which the view is inserted (last row shorter than `perRow`).
- `afterUse(prevMomentId, row)` → the right-hand candidate after a swap is the previous moment.
- `nextPanel(tree, panelId, dir)` → next/previous panel in cut order, crossing scenes, `null` at the ends.
- UI-only: players, sync start, sound toggle, keys, drag right→left.

**Done when:** typecheck + test:all green; on Arrifana a filled, a CHOOSE and an empty panel each open under their row,
swapping and swapping back work with undo, keys work in Safari.

## BE3 — Pool: find what's missing

Replaces `MomentDrawer`; afterwards no side drawer remains (remove the drawer column).

**Behaviour**
- The pool lists unused moments (as today). A tile shows **≈ N** (neutral grey corner mark) when a moment of its look
  group is already in panel N (`slotFor`); no mark = new.
- Sort within the scene's event: ★ new, ★ ≈, new, ≈ — each group in recording time. Chip **"Only new"** hides ≈ tiles.
  (Rejected / hidden stay in the existing "out" section.)
- Hover on a tile shows ★ / ✕ / seen buttons (same actions as before).
- Click a tile:
  - **≈ N** → open panel N's view (BE2) with this moment as the right-hand candidate (switch scene if needed).
  - **new** → **placement**: switch to the target scene (the viewed scene if it is for the moment's event, else the
    scene with the moment's recording-time neighbours; none → offer "New scene for <event>"); show a **ghost panel**
    (dashed violet, the moment's thumb) at the slot its recording time fits (between the panels whose moments are
    before/after it). Under the ghost's row a placement view: one big player of the moment, its clip timeline (marks),
    and **Insert here** · ◀ ▶ (shift the ghost one slot) · Cancel (`Esc`). The ghost can also be dragged to any slot,
    or onto an empty/CHOOSE panel (= fill/decide that panel). Insert = one add-panel request = one undo step.
- Double-click a tile = open its placement / panel view (same as click); no clip view.

**Tests first** (`tests/unit/web/board-pool.test.ts` additions, `web/src/board/pool.ts`)
- `poolMark(m, tree, moments)` → `{ kind: 'similar', panelNo, panelId } | { kind: 'new' }`.
- `poolSort` groups/order; `onlyNew` filter.
- `ghostSlot(m, scene, moments)` → slot index by recording time (before first, between, after last; panels without a
  time are skipped for the comparison).
- `placementScene(m, tree, moments, viewedSceneId)` → scene id or `null` (= offer new scene).
- UI-only: ghost rendering, dragging the ghost, routing clicks, hover buttons.

**Done when:** typecheck + test:all green; on Arrifana a ★ new moment lands via the ghost in a sensible spot, a ≈ moment
opens the right panel with it on the right; no side drawer left.

## BE4 — Create a moment (F6)

**Behaviour**
- On any big player's clip timeline (panel view left/right, placement view), dragging across footage that no existing
  moment covers offers **"New moment"** (small button at the selection). Overlap with existing moments is allowed
  only at the edges (the selection is clamped to the free stretch it started in).
- Creating it: a new moment for that clip — range = selection, `status` confirmed/user (green, protected like other
  user edits), tier `solid`, description empty (editable inline afterwards), speed 1, no Gemini call.
- Its look fingerprint is computed right after creation in the background (`fillLookFingerprints` for that one
  moment); the board refreshes its similar ids / look group when done. No fingerprint yet = treated as "new" in the pool.
- The new moment becomes the right-hand candidate of the open panel view (or replaces the placement view's moment);
  it also shows in the pool.
- Right-hand player's timeline gets trim handles too (trims the candidate moment).
- API: `POST /clips/:id/moments {start_sec, end_sec, description?}` → moment row; logged as one undo step
  ("New moment"); undo deletes the moment (refused if it is used in a panel — then undo the placement first; or the
  op log handles both in order).
- CLI parity (assistant acts through CLI verbs): `clippilot moment add <clip> <start> <end> [--description]`
  `--json`, same service call, `--ai` marks it as Claude's (unconfirmed, AI source).

**Tests first**
- Service: `createMoment(clipId, start, end, opts)` — clamps to clip length, rejects `end <= start`, user source is
  confirmed + tier solid; `ai` source is proposed; undo/redo via op log removes/restores it.
- Route + CLI: happy path and validation (integration test like existing moment verbs).
- Web pure: `freeStretch(clipMoments, t, duration)` → the free range around `t`; `clampSelection`.
- UI-only: drag-select on the timeline, button, background fingerprint refresh.

**Done when:** typecheck + test:all green; on Arrifana a new moment made from a panel's clip can be compared, used,
undone; after a few seconds it joins its look group.

## BE5 — Full screen compare

- `F` or ⤢ (top-right of the panel view) shows the two-up full screen (fixed overlay, black background, both players as
  large as possible side by side; candidate row hidden; ←/→ and `Enter` still work; `Esc` leaves full screen).
- Each player also has its own ⤢: that side alone full screen with its long clip timeline and the transcript of the
  clip (the existing "Spoken" block). `Esc` back.
- **Tests first:** pure layout helper `fitTwoUp(viewW, viewH, aspectL, aspectR, gap)` → both rects (same height, fit
  width; portrait clips work). UI-only otherwise.
- **Done when:** in Safari both sides fill the screen for two similar shots; keys work.

## Deferred
- **Clip tool** (own page / tool): one clip, all its moments, edit tools — plus a browser for clips the AI skipped
  completely (no moment anywhere).
- Gemini description for a user-made moment.
- Board fixes part 3 (critic findings) — after BE5, grill first.

## Feedback round 1 (raw, 2026-11-25)
- **F1** Editable strip: drag panels to reorder; drag a moment between two panels → new panel there; click between two
  panels → empty panel.
- **F2** Only 4–5 panels visible; more rows (like a storyboard) or a smaller strip?
- **F3** Similar moments underneath each panel, so swapping becomes the main edit flow (idea, unsure).
- **F4** Details under the open panel instead of a side drawer (alternative to F3); makes the drawer's top obsolete.
- **F5** Compare the chosen moment with one candidate side by side, both as big as possible; default or option?
- **F6** Create a new moment (today only change / vote down).
- Pool use case (round 3): "I see a moment I like — is a similar one already in the story? Which is better? If not,
  where would it go?" → pool marks + routing (BE3).
