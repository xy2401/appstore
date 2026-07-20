# Apple Top Charts Archive

This project downloads Apple top-chart feeds, archives them by date, caches media metadata and artwork, and publishes a static browser for exploring the results.

## Features

- **Regions**: United States (`us`), China (`cn`), and Japan (`jp`).
- **Media**: Apps, music, podcasts, books, and audiobooks where Apple provides a regional feed.
- **Charts**: Free and paid apps/books, top songs, top albums, top podcasts, and top audiobooks.
- **Historical archive**: Ranking JSON is stored in date-stamped directories under `rankings/YYYYMMDD/`.
- **Local assets**: Lookup metadata is cached in `details/` and artwork is downloaded to `logos/`.
- **Static web interface**: Filter by date, region, media type, and chart; inspect media details; or open the source JSON.
- **Optional Markdown output**: Generate Markdown summaries alongside ranking JSON files.
- **Automation**: GitHub Actions refreshes the archive monthly and deploys the repository to GitHub Pages.

## Requirements

- PowerShell 5.1 or PowerShell Core 7+
- Internet access to Apple's RSS and iTunes Lookup APIs

## Download rankings

Run the downloader from the repository root:

```powershell
.\downloader.ps1
```

### Parameters

| Parameter | Default | Description |
| --- | --- | --- |
| `-SkipExisting` | `$false` | Reuse existing detail and artwork files instead of downloading them again. |
| `-GenerateMarkdown` | `$false` | Generate `.md` summaries alongside ranking JSON files. |
| `-Limit` | `100` | Maximum number of results requested from each Apple feed. |

Examples:

```powershell
# Refresh all configured feeds
.\downloader.ps1

# Reuse cached metadata and artwork
.\downloader.ps1 -SkipExisting

# Request 50 results and generate Markdown summaries
.\downloader.ps1 -Limit 50 -GenerateMarkdown
```

## Browse the archive

Serve the repository through a local HTTP server because the interface loads JSON with `fetch`:

```powershell
python -m http.server 8080
```

Then open `http://127.0.0.1:8080/index.html`.

The interface automatically selects the newest available archive and provides dependent filters for region, media type, and chart. App records show software-specific fields such as ratings, screenshots, version, size, and compatibility. Other media types show the metadata available for that format, such as album, genre, release date, duration, track count, or author.

## Project structure

```text
.
├── downloader.ps1         # Apple feed, metadata, and artwork downloader
├── index.html             # Static web interface
├── script.js              # Filtering, list rendering, and detail modals
├── style.css              # Interface styles
├── rankings.json          # Generated index used by the web interface
├── rankings/
│   └── YYYYMMDD/          # Archived ranking feeds
├── details/               # Cached iTunes Lookup API responses
├── logos/                 # Locally cached artwork
└── .github/workflows/
    ├── update_rankings.yml
    └── static.yml
```

## Automation

`.github/workflows/update_rankings.yml` runs at `00:00 UTC` on the first day of each month and can also be started manually. It runs `downloader.ps1`, commits changed archive files, pushes them to the repository, and triggers the GitHub Pages deployment workflow.

`.github/workflows/static.yml` also deploys the repository on pushes to `main`.
