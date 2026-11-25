# Learning from edits (L0–L3)

> Moved verbatim from STATUS.md (and PRD.md) on 2026-11-25. Old names ("roadmap item 2b", "M3", "below") refer to
> the former layout; the current todo list is in [STATUS.md](../STATUS.md).

### Roadmap item 2c — Learning from human choices (grilling 2026-11-25, rounds 1–3)

**Idea (user):** human changes on the board are the answer key. After a project the user starts a learning step; Claude
finds what the user changed, works out which step of the pipeline should have done better, and proposes (A) changes to
that step's **agent instructions** and (B) **project proposals** for shortcomings that aren't instructions. The critics are
the definition of quality; Claude improves the cut with the editing tools.

**Decisions**
- [L-1] Not the dropped taste profile: nothing changes on its own; each proposal names its evidence and when it applies;
  the user accepts / edits / rejects each one. ARCHITECTURE decision 9 rewritten.
- [L-2] Learnable = **every** agent instruction: analyze, shake verify, brief, draft, edit, cut critic, story critic,
  review loop (Claude's own instructions = the skills). Code rules and config thresholds (2–8 s window, jitter bands) are
  project proposals, not direct edits.
- [L-3] All instructions live in `instructions/`; `.claude/skills` and `.claude/agents` only point there (decision 13).
- [L-4] Overview "Pipeline: who does what" in ARCHITECTURE.md (extends the existing flow; PRD "Workflow" stays the
  product view). Learning uses it to decide where a lesson belongs.
- [L-5] New **edit** skill: catalogue of the editing tools that exist **today** (no new tools in this item); drafter and
  review loop edit with it, critics read it so they only propose possible fixes.
- [L-6] Human interventions are found **statically** at the end: the AI's last version vs the final cut, plus the moment
  flags that exist (status, ai_* vs current range/speed, ★, reject reason, hidden clips, panel source). Needs one new
  fact: who made each edit step.
- [L-7] Signals: the user corrected the AI; the user reverted / re-changed an applied finding (critic wrong); the user
  changed something the critic didn't flag (critic missed).
- [L-8] No reasons asked while editing (👎 keeps its reason); the learning step asks one short question per pattern.
- [L-9] Learning only when the user starts it. One project is enough if the user accepts a proposal. No replay or other
  extra checks. Claude (Opus) does it; no video, stills only where a lesson needs visual proof.
- [L-10] Accepted instruction diffs are edited directly into `instructions/` (git history is the record). Project
  proposals go to STATUS.md "Proposals"; resolve-prep ones to `~/dev/clippilot-post/status.md`. New critic angles = proposal
  only.

**Order:** A2 ✅ (merged; migration 027 taken, L0 moves its new prompt text too); then L0 → L1 → L2 → L3.
Recording (L1) must be in before the full Portugal run so Portugal produces data.

**L0 — instructions in one place (refactor, no behaviour change).**
- `instructions/`: `analyze.md`, `shake-verify.md`, `story-critic.md` (Gemini prompts with `{{placeholders}}` where code
  fills values today), `clippilot.md` (CLI reference + cold start + events), `brief.md`, `draft.md`, `edit.md`,
  `cut-critic.md`, `review-loop.md`. Content moved, not rewritten: brief / draft / edit are cut out of today's
  `clippilot` SKILL.md; `edit.md` collects every edit verb (what it does, when to use it, protection rules, `--ai`) and maps
  the critics' finding kinds (`trim`, `replace`, `remove`, `reorder`, `move_scene`, `speed`, `cut_out`) onto the verbs.
- Code: a small loader (`src/core/instructions.ts`: read file, fill placeholders, fail on a missing one) used by
  analyze, shake verify, story critic.
- `.claude/skills/{clippilot,clippilot-brief,clippilot-draft,clippilot-edit,cut-critic,review-loop}/SKILL.md` and
  `.claude/agents/cut-critic.md` = frontmatter (description = when to use) + "Read and follow
  `~/dev/clippilot/instructions/<name>.md`". Cross-references between skills name the instruction file.
  `npm run skill:install` installs all six skills + the agent.
- Tests first: for each Gemini prompt, the rendered prompt equals today's text exactly (golden captured from the current
  code before moving); loader fails on missing placeholder / missing file; every `instructions/*.md` is referenced by a
  SKILL.md, an agent or code, and every step in the ARCHITECTURE table names an existing file.
- Done when typecheck + test:all green, the prompt goldens match (no analyze prompt version bump), skills install.

**L1 — who made each edit.**
- Migration (next free number): `operations.actor TEXT NOT NULL DEFAULT 'user' CHECK (actor IN ('ai','user'))`.
- Rule: `ai` = `cut apply`, `shakes fix` and any edit verb run with `--ai`; `user` = the board and edit verbs without
  `--ai` (Claude acting on the user's request in chat is the user's decision, as today). Add `--ai` to the scene and panel
  verbs that lack it (`scene add|rename|move|delete|set-event`, `panel add|move|delete|intent`); `instructions/edit.md` and
  `review-loop.md` say the review loop always passes `--ai`.
- Backfill: existing rows from their labels where unambiguous (draft apply, shakes fix, `--ai` labels), else `user`.
- `cut history --json` shows `actor`.
- Tests first: actor stored per entry point (board route, CLI with/without `--ai`, apply, shakes fix); undo/redo keep
  it; backfill.

**L2 — `clippilot learn context [--cut id] --json` (static).**
- Baseline = the `after` snapshot of the last non-undone `ai` operation of the cut; final = current state. Pure diff
  function over two snapshots: scenes added / removed / renamed / reordered; panels added / removed / moved / moment swapped
  / intent changed; moments re-trimmed / speed changed / ★ / rejected (with reason) / reset; clips hidden. Each item says
  whether it was AI-made in the baseline.
- Also: user-flagged items that already existed in the baseline (moment flags, `source = user` panels); AI operations the
  user undid (label); every critic finding of the cut from `.clippilot/reviews/*.json` with its resolution and whether the
  user later changed that panel / moment again; the brief; totals (AI length vs final length).
- Tests first: diff function per change type; baseline choice (undone AI ops skipped; no AI op → empty baseline, say so);
  finding ↔ later user change link.

**L3 — learning skill `clippilot-learn` (`instructions/learn.md`).**
- Started by the user only ("learn from this project / cut"). Reads `learn context`, the ARCHITECTURE pipeline table and
  every `instructions/*.md`.
- Groups interventions into patterns; per pattern: evidence (panels, AI vs user value), the owning step, and either (A) a
  concrete diff to that step's instruction file or (B) a project proposal (missing tool, step order, coded rule, board
  friction, new critic angle). One short question per pattern to the user; then accept / edit / reject each.
- Accepted (A): edited in `~/dev/clippilot` following the repo's git workflow (worktree, commit, merge); (B) appended to
  STATUS.md "Proposals" (or clippilot-post `status.md`).
- No video; stills only when a lesson needs visual proof. Final message: accepted / rejected counts, files changed.
- Done when: run on the Arrifana "Main" cut (whose history has user edits) produces at least one pattern per signal kind
  present, and the user judged the proposals.
