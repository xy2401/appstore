# Apple Top Charts Archive

This project downloads Apple top-chart feeds, archives them by date, caches media metadata and artwork, and publishes a static browser for exploring the results.

## Features

- **Regions**: United States (`us`), China (`cn`), and Japan (`jp`).
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

Run the Node.js downloader from the repository root:

```bash
node scripts/downloader.mjs
```

### Options

| Option | Default | Description |
| --- | --- | --- |
| `--skip-existing` | Off | Reuse cached ranking, detail, and artwork files. |
| `--generate-markdown` | Off | Generate `.md` summaries alongside ranking JSON files. |
| `--limit <number>` | `100` | Maximum results requested from each Apple feed. |
| `--concurrency <number>` | `4` | Concurrent detail and artwork requests. |
| `--date <YYYYMMDD>` | Current UTC date | Override the archive date for a backfill. |
| `--help` | — | Show command usage. |

Examples:

```bash
# Refresh all configured feeds
node scripts/downloader.mjs

# Reuse the current archive and cached assets
node scripts/downloader.mjs --skip-existing

# Request 50 results and generate Markdown summaries
node scripts/downloader.mjs --limit 50 --generate-markdown

# Create or refresh a specific archive date
node scripts/downloader.mjs --date 20260701 --skip-existing
```

The downloader applies request timeouts, bounded concurrency, retry with exponential backoff, and temporary-file writes. Failed regional feeds do not stop other feeds from being archived.

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

`.github/workflows/update_rankings.yml` runs on Ubuntu with Node.js at `00:00 UTC` on the first day of each month and can also be started manually. It runs `scripts/downloader.mjs`, commits changed archive files, pushes them to the repository, and dispatches the GitHub Pages deployment workflow.

`.github/workflows/update_rankings-ps.yml` is retained as a disabled rollback reference. Its job has a constant false condition and cannot execute the legacy downloader unless that condition is deliberately removed.

`.github/workflows/static.yml` deploys the repository on pushes to `main` and when manually dispatched by the update workflow.
