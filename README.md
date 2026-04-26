# ClipPilot

**Chat with your video footage. Get a DaVinci timeline out.**

ClipPilot ingests a folder of clips, sends each one to Google Gemini for
structured analysis (scenes, quality scores, editorial ratings, keywords),
and then exposes the result as a CLI you drive — by hand, or by chatting
with Claude Code via the bundled skill.

The skill ([`.claude/skills/clippilot/SKILL.md`](.claude/skills/clippilot/SKILL.md))
turns ClipPilot into a conversational tool: *"find me the morning shots
where Anna is laughing,"* *"show me everything from the wedding,"*
*"mark this take as the best, then export the selection to FCPXML."*
DaVinci Resolve is where the visual edit actually happens — ClipPilot
gets you to a curated timeline file.

**Originals are never touched.** ClipPilot reads source files once to
build proxies; everything else operates on proxies and metadata, and
exports reference original paths.

## Prerequisites

- **Node.js 20+**
- **tsx** — `npm install -g tsx`
- **ffmpeg / ffprobe** — for proxies and thumbnails
- **A Google Gemini API key** — [get one here](https://aistudio.google.com/apikey)
- **Claude Code** (recommended) — for the conversational experience

```bash
# macOS
brew install node ffmpeg && npm install -g tsx

# Ubuntu/Debian
sudo apt update && sudo apt install -y nodejs npm ffmpeg && npm install -g tsx
```

## Install

```bash
git clone https://github.com/mbinz/clippilot.git
cd clippilot
npm install
npm link              # makes "clippilot" available globally
npm run skill:install # installs the Claude Code skill globally
clippilot --version
```

## Quickstart

The fastest path is to let Claude walk you through it.

1. **Set the API key** — either as an env var or via `clippilot config`:

   ```bash
   export GEMINI_API_KEY="your-key-here"
   # or
   clippilot config set gemini_api_key "your-key-here"
   ```

2. **Open Claude Code in the folder where you want your project** (any
   empty folder is fine — ClipPilot stores everything in `.clippilot/`
   inside that folder).

3. **Tell Claude what you want to do.** With the skill installed, prompts
   like these just work:

   - *"I have footage at `/Volumes/SD/2026-04-mallorca`. Let's review it."*
   - *"Show me the best shots from yesterday."*
   - *"Find me wide establishing shots, render a contact sheet."*
   - *"Mark clip 17 as best of its similar group."*
   - *"Export clips 4, 12, 3, 8 to FCPXML for DaVinci."*

   Claude checks `clippilot stats`, walks you through `ingest` and
   `analyze` if needed, and then drives the conversational verbs.

If you'd rather use the CLI directly, the same flow is:

```bash
clippilot ingest /path/to/footage --project "Mallorca 2026"
clippilot analyze
clippilot search "sunset" --min-quality 3 --json
clippilot contact-sheet --query "morning" -o /tmp/sheet.png
clippilot export --clips 1,5,12,3 --format fcpxml --output timeline.fcpxml
```

## Commands

Every read command supports `--json` for machine-readable output (this is
what the Claude skill consumes). Use `clippilot <command> --help` for
flags.

| Command | Purpose |
|---|---|
| `clippilot ingest <path>` | Scan a folder, build proxies + thumbnails, write metadata |
| `clippilot analyze` | Send pending clips to Gemini for structured analysis |
| `clippilot stats` | Project + analysis-status overview |
| `clippilot search <query>` | FTS over scenes, summary, keywords, tags, location, people |
| `clippilot get-clip <id>` | Full metadata + thumbnails + similarity-group memberships |
| `clippilot similar <id>` | Other clips clustered with this one (location/time/keywords/scene) |
| `clippilot mark-best <id>` | Pick the best take in its similarity group(s) |
| `clippilot tag <id>` | Edit location, tags, people |
| `clippilot contact-sheet` | Render a labeled grid PNG for visual scanning |
| `clippilot export` | Emit CSV / JSON / EDL / FCPXML for DaVinci |
| `clippilot config show / set` | Inspect or change config (`gemini_api_key`) |

Export formats:

- **FCPXML** — DaVinci Resolve: *File → Import Timeline → FCPXML*
- **EDL** — CMX3600, widely supported
- **CSV / JSON** — Spreadsheet or programmatic use

## Project storage

ClipPilot stores everything in `.clippilot/` next to where you run it:

```
.clippilot/
  clippilot.db        # SQLite (clips, projects, similarity, thumbnails)
  config.json         # Gemini key, settings
  proxies/            # 720p MP4 proxies
  thumbnails/         # JPEG thumbnails
```

Re-running `ingest` on the same folder is safe — clips are deduplicated by
SHA-256 hash.

## Estimated API costs

Gemini 2.5 Flash is used for cost efficiency:

| Footage | Cost |
|---|---|
| 1 hour (weekend) | ~$0.28 |
| 5 hours (vacation) | ~$1.40 |
| 15 hours (long trip) | ~$4.20 |

## Web UI (legacy, optional)

A web UI exists at `clippilot ui` (port 3847). It predates the Claude skill
and offers a thumbnail grid + facet filters. It is **not** the primary
interface anymore and may be removed in a future release once the
conversational flow plus `contact-sheet` proves sufficient — see [PLAN.md](PLAN.md).

If you want to use it:

```bash
cd web && npm install && npm run build && cd ..
clippilot ui
```

## Development

```bash
npm test                  # unit tests
npm run test:integration  # integration tests (needs ffmpeg)
npm run test:all          # everything
npm run typecheck         # strict TypeScript check
```

Project state is tracked in [STATUS.md](STATUS.md). Active direction is in
[PLAN.md](PLAN.md).

## License

MIT
