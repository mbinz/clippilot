# Board views — lock-in

Status: **grilled 2026-11-27, mockup next** ([mockups/board-views.html](../../mockups/board-views.html)). No slices
yet — they get written after the mockup is approved. Comes **before** every other open todo; the Safari pass of board
editing is folded in (test the new views, not the old ones). Board fixes part 3 (critic findings) is re-grilled after
this, because it assumed the BE2 panel view.

Origin: UI feedback round 2026-11-27 — storyboard overview "good"; pool sections ("★ new", "already in story", "similar
to panel") not understood; clicking a panel shouldn't jump straight into the comparison; the comparison needs both
videos + candidates on one screen without scrolling; alternatives must be unused moments only.

## Two modes

### Overview (today's top part — kept)
- Scene selector on the left, panel grid (wrapping, BE1), pool below. Drag a pool tile onto the grid to place it.
- **Pool:** one list, ★ first, then recording time. No sections, **no ≈ mark, no "Only new" chip.** (Look groups stay in
  the draft rule and critic, just not in the pool UI.)
- **Click a pool tile** → **moment overlay** on top of the overview: one big video looping the moment (sound on), the
  clip timeline below with the clip's other moments marked (click one → the overlay switches to it), ★ / ✕ / seen. No
  trim, no placing. `Esc` closes. The BE3 ghost placement on click is gone — placing is drag-only.
- Click a panel → panel focus.

### Panel focus (locked screen)
- The page doesn't scroll vertically. The scene selector and the pool are hidden.
- **Strip** on top (~90 px): the **current scene's** panels in one horizontal row (sideways scroll if needed), scene name
  at its left. Click selects, hover plays. **Drop** a candidate tile or the right player **on a panel** = replace its
  moment; **between panels** = insert a new panel. One undo step each. `Tab` / `Shift+Tab` = next / previous panel,
  stopping at the scene's edges (nothing crosses scenes).
- **Details** (default for a filled panel): one big video looping the panel's range; the clip timeline with trim handles
  below; **Find alternatives** (`A`); ★ / ✕; ⋯ menu (speed, intent, delete panel, hide clip, show in Finder). No text.
- **Split** (via Find alternatives; CHOOSE and empty panels open straight into it):
  - Two players sized to the remaining height (`fitTwoUp`), candidate row below (~110 px, sideways scroll).
  - Right: **Use this** (`Enter`), ★, ✕. Left: ★, ✕. Small sound toggle. No timelines, descriptions or transcript.
  - After Use this you stay in split; the replaced moment becomes the right-hand candidate (swap back = `Enter`).
  - ←/→ moves through the candidates.
- **Candidates** exclude every moment that is in any panel — in all three groups (AI candidates, look-alikes, same
  event). Exception: the moment just replaced (so swap-back works).
- `F` = both sides full screen (BE5, kept). The per-side ⤢ is removed.
- `Esc`: split → details → overview (CHOOSE / empty: split → overview).
- Mac desktop only for now; no layout below 900 px.

## Code touch points (for the slices)
- `candidateRow` (`web/src/board/panelview.ts`): drop used moments from groups 1–2 too.
- `poolMark` / `poolSort` / `onlyNew` (`web/src/board/pool.ts`): pool becomes ★ first + recording time; marks and chip
  go. `ghostSlot` / placement-on-click go away.
- BE2 panel view inserted under the row → replaced by the panel-focus screen.

## Deferred
- What the pool is really for (user unsure yet) — revisit after living with the simple version.
- Cross-scene navigation in panel focus.
