# Board editing (feedback round 1, 2026-11-25)

**Status:** raw feedback, not analysed yet. Next step: sequence it against the other open todos (STATUS.md), then
grilling rounds → mockup → build (product-direction change). No slice codes yet.

User feedback on the board (v0.3, Arrifana cut, Safari), recorded as given:

## F1 — Panel strip is editable
- Drag and drop panels to change their order.
- Drag a moment into the strip between two panels → creates a new panel at that position.
- Click the space between two panels → creates an empty panel there.

## F2 — Use the screen better
- Only 4–5 panels are visible today; the rest needs scrolling.
- Options to explore: several rows (like a real storyboard), or a smaller strip (user doubts that one).

## F3 — Similar clips under each panel (idea, unsure)
- Show similar moments underneath each panel, so swapping / choosing another moment becomes the main edit flow.

## F4 — Details under the open panel instead of a side drawer
- Click a panel → its details open underneath it; that becomes the main edit area (choose another moment, see
  details, …).
- Alternative to F3 (either this or F3). Would make the top part of today's drawer obsolete.

## F5 — Compare two moments side by side
- The panel's chosen moment next to one replacement candidate, both as big as the screen allows — for very similar
  shots.
- Open question: default view or an option? If an option, how is it opened?

## F6 — Create a new moment
- Today moments can only be changed or voted down; the user can't add one (e.g. mark in/out on a clip).

## Notes for the analysis (not decisions)
- F3/F4/F5 overlap: all three are about "choose another moment for this panel". Likely one design question.
- F3 builds on similar moments (SM2 drawer ranking, SM3 look groups); group sizes are still being tuned (SM-9).
- F1/F6 are edits → must go through undo + `operations.actor` (L1) like every other board edit.
- Touches "Board fixes, part 3" (critic findings on the board) — both change the panel/drawer area; plan together.
- Check against the UI principles: calm view, details on click, hover video, undo everything.
