---
name: review-loop
description: Use when the user wants Claude to review and improve a ClipPilot cut ("review the cut", "critique and fix the draft", "run the critics", "Review-Loop", "mach den Schnitt besser") — runs the cut critic (sub-agent) and the story critic (Gemini), applies the must/should findings as AI edits (undoable on the board), max 3 rounds, and reports a short change list. Needs the clippilot skill's CLI.
---

# Review loop — critics review, Claude applies, the user decides

Two critics look at the cut; **only you (Claude) edit**, and only what the critics proposed. Critics never edit.
Everything you change is an AI edit: undoable on the board (Cmd+Z, one step per command) and still marked as an AI pick.

Run every command in the project directory (the folder containing `.clippilot/`). If `clippilot` is not on PATH use
`~/dev/clippilot/node_modules/.bin/tsx ~/dev/clippilot/bin/clippilot.ts`.

## 0. Before round 1

**Always name the cut.** Commands without a cut id work on the cut "Main". Find the id with `clippilot cut list --json`
and pass it everywhere: `cut show <id>`, `critic … --cut <id>`, and `--cut <id>` on every `moment …` verb (that is where
its undo step is logged). `panel …` verbs find their cut themselves.

1. `clippilot cut show <id> --json` → panel count, brief state. The brief must be `confirmed`; if not, stop and ask the
   user to confirm it first (clippilot skill, "Brief first").
2. `clippilot motion --json` (fast when already measured; it fills jitter + shakes for new moments). Not optional: the
   cut critic needs `jitter` and `shakes`.
3. **Cost.** `clippilot critic story --json` renders the preview and prints `{estimate_usd, …}` (exit code 2 = estimate
   only, nothing spent). Tell the user: "Story critic (Gemini) ≈ $X per run, 2 runs (round 1 and the last round) ≈ $2X.
   OK?" and **wait for their yes**. Without a yes, run the loop with the cut critic only and say so.

## 1. One round (r = 1, 2, 3)

1. **Cut critic:** spawn the `cut-critic` sub-agent (Agent tool, `subagent_type: "cut-critic"`) with: project directory,
   cut id, round r, output dir `.clippilot/reviews/work-r<r>` (if the `cut-critic` agent type is not available, do its
   job yourself following the `cut-critic` skill). It saves its findings and returns the file name.
2. **Story critic** (round 1 and the final round only, and only with the user's cost OK):
   `clippilot critic story --cut <id> --yes --round <r> --json`.
3. Read both: `clippilot critic show <file> --json`. Group findings by panel:
   - same panel, same kind → apply once (the cut critic's numbers win for trims / cut-outs, the story critic's for
     order / scene membership), then resolve the finding in **each** file (ids differ per file: `f1` vs `F1`).
   - same panel, different kinds: complementary ones are both applied (`speed` → 1 plus a `trim`; `move_scene` plus a
     `trim`); conflicting ones (`trim` vs `remove`, `replace` vs `trim`): prefer the smaller change that fixes the stated
     problem, resolve the other `skipped --note "superseded by <file>#<id>"`.
   - `critic context --cut <id> --out <dir> --json` has a `brief_check` (must-haves in the cut, played total vs target):
     a missing must-have the critics didn't catch is your own finding to raise in the report (don't invent edits).
4. **Apply** every `must` and `should` finding that is **not protected**, one command per finding, always with `--ai`
   where the verb has it:

   | kind | command |
   |---|---|
   | `trim` {start_sec, end_sec} | `clippilot moment trim <moment_id> <start> <end> --ai --cut <id>` |
   | `cut_out` {from, to} | `clippilot moment cut-out <moment_id> <from> <to> --ai --cut <id>` |
   | `speed` {speed} | `clippilot moment speed <moment_id> <speed> --ai --cut <id>` |
   | `replace` {moment_id} | `clippilot panel place <panel_id> <new moment_id> --ai` |
   | `remove` | `clippilot panel delete <panel_id>` |
   | `reorder` {position} | `clippilot panel move <panel_id> <same scene id> <cli_position>` |
   | `move_scene` {to_scene_id, position?} | `clippilot panel move <panel_id> <to_scene_id> <cli_position>` |

   Positions: findings use 1-based `position`; `panel move` is **0-based**. Use the `cli_position` that
   `critic show --json` adds to each finding (no position on a `move_scene` = append at the end).
   | `other` / no proposal | don't apply; list it for the user |

   After each command record the outcome: `clippilot critic resolve <file> <finding id> applied` (or `skipped --note
   "<why>"` when the command failed or the proposal no longer fits, e.g. the panel was already removed).
   Protected findings: `clippilot critic resolve <file> <id> protected` — never apply them, list them for the user.
   Nits: leave unresolved, list them.
5. **Stop** when the round produced no unprotected `must`/`should`, or after round 3. Otherwise next round (the cut
   critic sees the changed cut; tell it the round number).

Never: edit a protected panel or moment; apply a nit; invent changes no critic proposed; run `cut apply` (it would
replace the draft); spend on the story critic without the user's OK.

## 2. Report (in chat, short)

`clippilot critic summary --cut <id> --json` gives per round the counts and the applied change lines (labels as they
were when the critics looked, i.e. before your moves). Write:

- One line per round: "Round 1: 6 changes (3 must, 3 should), 1 protected, 2 nits" (use `distinct_changes`).
- The applied changes, one line each, by panel label ("S2·P3 trim 12.0–15.5 s — speech no longer cut").
- **For you to decide** (protected findings and nits), one line each with the critic's reason.
- Total length before → after vs the brief's target.
- "Everything is undoable on the board (Cmd+Z) — each change is one step."

Then stop and let the user look at the board / preview. Don't export unless asked.
