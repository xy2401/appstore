# Apple Top Charts Archive

This project downloads Apple top-chart feeds, archives them by date, caches media metadata and artwork, and publishes a static browser for exploring the results.

## Features

- **Regions**: United States (`us`), China (`cn`), Japan (`jp`), United Kingdom (`gb`), Germany (`de`), and France (`fr`).
- **Media**: Apps, music, podcasts, books, and audiobooks where Apple provides a regional feed.
- **Charts**: Free and paid apps/books, top songs, top albums, top podcasts, and top audiobooks.
- **Historical archive**: Ranking JSON is stored in date-stamped directories under `rankings/YYYYMMDD/`.
- **Local assets**: Lookup metadata is cached in `details/` and artwork is downloaded to `logos/`.
- **Static web interface**: Filter by date, region, media type, and chart; inspect media details; or open the source JSON.
- **Zero-dependency downloader**: The active downloader uses only built-in Node.js APIs.
- **Automation**: GitHub Actions refreshes the archive monthly and deploys the repository to GitHub Pages.

## Requirements

- Node.js 24 or later
- Internet access to Apple's RSS and iTunes Lookup APIs
- PowerShell 5.1 or PowerShell Core 7+ only when using the legacy downloader

## Download rankings

The downloader is split into three resumable stages that match the generated directories:

1. `rank` downloads Apple ranking RSS JSON into `rankings/YYYYMMDD/`.
2. `details` reads that archive and downloads iTunes Lookup JSON into `details/`.
3. `media` downloads artwork into `logos/`, optionally generates Markdown, and rebuilds `rankings.json`.

Run all three stages from the repository root:

```bash
node scripts/downloader.mjs
# Equivalent to: node scripts/downloader.mjs all
```

Only the six country tasks (`us`, `cn`, `jp`, `gb`, `de`, and `fr`) run concurrently during the `rank` stage. Feeds within each country are fetched in order, and the `details` and `media` stages are sequential. This keeps request behavior predictable while still allowing the independent countries to make progress together.

### Options

| Option | Default | Description |
| --- | --- | --- |
| `--skip-existing` | Off | Reuse cached ranking, detail, and artwork files. |
| `--generate-markdown` | Off | Generate `.md` summaries alongside ranking JSON files. |
| `--limit <number>` | `100` | Maximum results requested from each Apple feed. |
| `--date <YYYYMMDD>` | Current UTC date | Override the archive date for a backfill. |
| `--help` | — | Show command usage. |

Examples:

```bash
# Run the stages separately
node scripts/downloader.mjs rank --date 20260701
node scripts/downloader.mjs details --date 20260701
node scripts/downloader.mjs media --date 20260701

# Resume all stages while reusing completed files
node scripts/downloader.mjs all --date 20260701 --skip-existing

# Request 50 ranking results, then generate Markdown in the media stage
node scripts/downloader.mjs rank --date 20260701 --limit 50
node scripts/downloader.mjs details --date 20260701
node scripts/downloader.mjs media --date 20260701 --generate-markdown

# Show command help
node scripts/downloader.mjs --help
```

The downloader applies request timeouts, retry with exponential backoff, and temporary-file writes. A missing Apple feed (`404`) is skipped, while other unhandled download failures make the current stage fail so that an incomplete checkpoint is not committed.

### Legacy PowerShell downloader

The previous implementation is retained for rollback and comparison:

```powershell
.\scripts\downloader.ps1
.\scripts\downloader.ps1 -SkipExisting -GenerateMarkdown -Limit 50
```

Its GitHub Actions workflow is intentionally disabled.

## Browse the archive

Serve the repository through a local HTTP server because the interface loads JSON with `fetch`:

```bash
python -m http.server 8080
```

Then open `http://127.0.0.1:8080/index.html`.

The interface automatically selects the newest available archive and provides dependent filters for region, media type, and chart. App records show software-specific fields such as ratings, screenshots, version, size, and compatibility. Other media types show the metadata available for that format, such as album, genre, release date, duration, track count, or author.

## Project structure

```text
.
├── scripts/
│   ├── downloader.mjs     # Active zero-dependency Node.js downloader
│   ├── downloader.test.mjs # Node.js downloader unit tests
│   └── downloader.ps1     # Disabled legacy PowerShell downloader
├── index.html             # Static web interface
├── script.js              # Filtering, list rendering, and detail modals
├── style.css               # Interface styles
├── rankings.json          # Generated index used by the web interface
├── rankings/
│   └── YYYYMMDD/          # Archived ranking feeds
├── details/               # Cached iTunes Lookup API responses
├── logos/                 # Locally cached artwork
└── .github/workflows/
    ├── update_rankings.yml      # Active Node.js updater
    ├── update_rankings-ps.yml   # Disabled PowerShell updater
    └── static.yml               # GitHub Pages deployment
```

## Automation

`.github/workflows/update_rankings.yml` runs on Ubuntu with Node.js at `00:00 UTC` on the first day of each month and can also be started manually. It creates a Git checkpoint after each successful stage: ranking RSS first, detail JSON second, then media plus the published `rankings.json` index. If a later stage fails, the completed earlier checkpoints remain available for a resumed run. GitHub Pages is dispatched only after Stage 3 succeeds.

`.github/workflows/update_rankings-ps.yml` is retained as a disabled rollback reference. Its job has a constant false condition and cannot execute the legacy downloader unless that condition is deliberately removed.

`.github/workflows/static.yml` deploys the repository on pushes to `main` and when manually dispatched by the update workflow.
