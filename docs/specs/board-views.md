# Board views — lock-in (feedback round 2026-11-27)

Status: **raw feedback, not planned yet.** Needs grilling + sequencing against the other open todos (Safari pass,
Board fixes part 3, L0, Odeceixe) before any slice spec is written. User's direction: lock in these three views
**before anything else**.

## The three views to lock in

1. **Storyboard overview** (current top part of the board) — **good, keep as is.**
2. **Panel details** (new default when a panel is clicked) — simple: one big video of the panel. A **"Find
   alternatives"** button opens view 3. Clicking a panel must *not* jump straight into the comparison (today's BE2
   two-up) — "just not intuitive".
3. **Alternatives split view** (today's two-up / compare, reached only via "Find alternatives"):
   - No text descriptions / details — only the voting options.
   - Both videos **and** the candidate list on one screen.
   - Hide the scene selector on the left.
   - **Locked** view: no vertical scrolling.
   - Storyboard switches back to **horizontal scroll** in this view, so the whole timeline stays visible without
     scrolling vertically.

## Other feedback

- **Pool sections are confusing.** User sees: ★ new, ★ "already in story", new, "already in story", "similar to panel"
  and doesn't understand them. What the code means (`poolMark` / `poolSort` in `web/src/board/pool.ts`):
  - *new* = no moment of the same look group (SM3) is in the cut yet.
  - *≈ N* / "already in story" / "similar to panel N" = a similar-looking moment is already in panel N.
  - ★ = the moment is starred (hero); ★ sections come first.
  So it's two axes (starred × already-covered) shown as four sections plus a per-tile "≈ N" mark, with several labels
  for the same idea. Needs a simpler model — open question for the grill (e.g. one list, ★ first, "≈ N" as a quiet mark
  only; or just "unused / used").
- **Alternatives must exclude moments already on the timeline.** Only moments that are in no panel. Today
  `candidateRow` (`web/src/board/panelview.ts`) adds the panel's look-group `alternatives` even when they sit in another
  panel (shown with `inPanel`); only the event list filters by `usage`.

## Open questions for the grill

- Panel details: what else besides the big video (transcript? timeline/trim? vote?) — feedback says "simple".
- Where does the details view live: inline below the row (like BE2 today), overlay, or full width?
- Split view: which "voting options" exactly (keep / reject / ★ / swap in)?
- Pool: which of the four sections survive; one label for "≈"?
- Does BE5 full-screen compare stay, or does view 3 replace it?
- Relation to **Board fixes part 3** (critic findings inside the panel view) — that todo assumed the BE2 panel view.
