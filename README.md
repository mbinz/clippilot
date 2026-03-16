# ClipPilot

AI-powered CLI tool that helps you review large amounts of video footage, rate clips by quality, and export sequenced timelines for DaVinci Resolve.

ClipPilot uses Google Gemini to analyze your video clips — detecting scenes, rating technical quality, and assessing editorial value — so you can quickly find the best shots and assemble them into a story.

## How it works

1. **Ingest** — Point ClipPilot at a folder of videos. It creates lightweight 720p proxies, extracts thumbnails, and stores metadata in a local SQLite database.
2. **Analyze** — Each proxy is sent to Gemini 2.5 Flash, which returns structured scene descriptions, quality scores, and editorial ratings.
3. **Search** — Full-text search across all AI-generated descriptions and keywords.
4. **Export** — Export your clip selection as CSV, JSON, EDL, or FCPXML for DaVinci Resolve. Exports always reference the original full-quality files.

**Core principle: originals are never touched.** ClipPilot works exclusively with proxies. Your source files are only read once (to create the proxy) and referenced by path in exports.

## Prerequisites

- **Node.js** 20+
- **ffmpeg** and **ffprobe** installed and on your PATH
- A **Google Gemini API key** ([get one here](https://aistudio.google.com/apikey))

## Installation

```bash
git clone https://github.com/mbinz/clippilot.git
cd clippilot
npm install
```

To use `clippilot` as a global command:

```bash
npm link
```

Or run directly via:

```bash
npx tsx bin/clippilot.ts <command>
```

## Quick start

```bash
# 1. Set your Gemini API key
export GEMINI_API_KEY="your-key-here"

# 2. Import footage (creates proxies + thumbnails)
clippilot ingest /path/to/vacation-footage --project "Mallorca 2025" --location "Mallorca"

# 3. Analyze clips with AI
clippilot analyze

# 4. Search your footage
clippilot search "Kinder am Strand"
clippilot search "sunset" --min-quality 3 --sort quality

# 5. Export a selection for DaVinci Resolve
clippilot export --clips 1,5,12,3 --format fcpxml --output mallorca.fcpxml
```

## Commands

### `clippilot ingest <path>`

Scan a folder for video files, extract metadata via ffprobe, create 720p proxy files, and generate thumbnails.

```bash
clippilot ingest /path/to/footage \
  --project "Mallorca 2025" \
  --location "Cala Millor" \
  --tags "strand,urlaub,familie"
```

| Option | Description |
|--------|-------------|
| `--project <name>` | Project name (default: folder name) |
| `-l, --location <location>` | Location metadata for all clips |
| `-t, --tags <tags>` | Comma-separated tags |
| `--date <YYYY-MM-DD>` | Override recording date |
| `--no-proxy` | Skip proxy generation (e.g. footage is already low-res) |
| `--proxy-resolution <720\|480>` | Proxy resolution (default: 720) |
| `--skip-analysis` | Only import, don't auto-analyze |

Supported formats: `.mp4`, `.mov`, `.avi`, `.mkv`, `.mts`, `.m4v`, `.webm`

Re-running ingest on the same folder is safe — already-known clips are skipped (SHA-256 hash deduplication).

### `clippilot analyze`

Send pending clips to Gemini for AI analysis. Each clip receives:
- Scene-by-scene descriptions (German + English)
- Technical quality scores (stability, focus, exposure, composition, audio)
- Editorial ratings (emotional impact, storytelling potential, uniqueness)
- Suggested use: Hero Shot, B-Roll, Establishing, Transition, or Skip

```bash
clippilot analyze
clippilot analyze --force    # re-analyze all clips
```

| Option | Description |
|--------|-------------|
| `--project <name>` | Only analyze clips from this project |
| `--force` | Re-analyze already analyzed clips |

### `clippilot search <query>`

Full-text search across AI-generated summaries, keywords, locations, and tags.

```bash
clippilot search "Sonnenuntergang"
clippilot search "beach children" --min-quality 3 --sort quality --limit 10
```

| Option | Description |
|--------|-------------|
| `--min-quality <1-5>` | Minimum overall quality score |
| `--sort <field>` | Sort by: `quality`, `date`, `emotional`, `duration` |
| `--limit <n>` | Max results (default: 20) |

### `clippilot tag <clip-id>`

Manually edit metadata for a clip.

```bash
clippilot tag 5 --location "Cala Millor" --tags "sonnenuntergang,meer" --people "Anna,Max"
```

### `clippilot export`

Export a clip sequence for editing in DaVinci Resolve or other NLEs.

```bash
# Export specific clips by ID
clippilot export --clips 1,5,12,3 --format fcpxml --output timeline.fcpxml

# Export a story
clippilot export --story 1 --format edl --output timeline.edl
```

| Option | Description |
|--------|-------------|
| `--clips <ids>` | Comma-separated clip IDs |
| `--story <id>` | Story ID to export |
| `--format <format>` | `csv`, `json`, `edl`, `fcpxml` (default: csv) |
| `--output <path>` | Output file (prints to stdout if omitted) |
| `--title <title>` | Timeline title |
| `--fps <fps>` | Frame rate for timecodes (default: 30) |

**Export formats:**
- **FCPXML** — Import into DaVinci Resolve via File > Import Timeline > FCPXML
- **EDL** — CMX3600 format, widely supported by NLEs
- **CSV** — Simple spreadsheet-friendly format
- **JSON** — Structured data for programmatic use

All formats reference the **original file paths**, not proxies.

### `clippilot stats`

Show project statistics (clip count, analysis status, total duration).

```bash
clippilot stats
clippilot stats --project "Mallorca 2025"
```

### `clippilot config`

View or edit the configuration.

```bash
clippilot config show
clippilot config set gemini_api_key "your-key-here"
```

Configuration is stored in `.clippilot/config.json`. The Gemini API key can also be set via the `GEMINI_API_KEY` environment variable.

## Project structure

ClipPilot stores all its data in a `.clippilot/` directory relative to where you run it:

```
.clippilot/
  clippilot.db          # SQLite database
  config.json           # Configuration
  proxies/              # 720p MP4 proxy files
  thumbnails/           # JPEG thumbnails
```

Your original video files are never moved, renamed, or modified.

## Estimated API costs

ClipPilot uses Gemini 2.5 Flash for cost efficiency:

| Scenario | Footage | Estimated cost |
|----------|---------|----------------|
| Weekend trip | 1 hour | ~$0.28 |
| Week-long vacation | 5 hours | ~$1.40 |
| Large vacation | 15 hours | ~$4.20 |

## Development

```bash
npm test              # Run unit tests
npm run test:integration  # Run integration tests (requires ffmpeg)
npm run test:all      # Run all tests
npm run typecheck     # TypeScript type check
```

## License

MIT
