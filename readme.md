# iStore App Ranking Downloader

This project automates the process of fetching Apple App Store rankings, downloading app details and logos, and presenting the data in a user-friendly web interface.

## Features

-   **Multi-Region Support**: Fetches rankings for US and China (CN).
-   **Ranking Types**: Supports "Top Free" and "Top Paid" charts.
-   **Data Archiving**: Saves ranking data in date-stamped directories (`app_rankings/YYYYMMDD/`) for historical tracking.
-   **Rich Media**: Downloads high-resolution app icons locally.
-   **Web Interface**: Includes a modern, dark-themed `index.html` to browse rankings by date, country, and category.
-   **Markdown Generation**: Optionally generates Markdown summaries of the rankings.
-   **Automation**: Integrated with GitHub Actions to run automatically on the 1st of every month.

## Usage

### Prerequisites

-   PowerShell 5.1 or later (Windows) or PowerShell Core (Cross-platform).
-   Internet connection to access Apple's RSS feeds and iTunes API.

### Running the Script

Run the `app_downloader.ps1` script from the root directory:

```powershell
.\app_downloader.ps1
```

### Parameters

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `-SkipExisting` | Switch | `$false` | If specified, skips downloading app details and logos if they already exist locally. By default, it forces a re-download to ensure fresh data. |
| `-GenerateMarkdown` | Switch | `$false` | If specified, generates Markdown files (`.md`) alongside the JSON ranking files. |

**Examples:**

1.  **Standard Run** (Force update, no markdown):
    ```powershell
    .\app_downloader.ps1
    ```

2.  **Skip Existing Files** (Faster run):
    ```powershell
    .\app_downloader.ps1 -SkipExisting
    ```

3.  **Generate Markdown**:
    ```powershell
    .\app_downloader.ps1 -GenerateMarkdown
    ```

## Web Interface

Open `index.html` in your web browser to view the rankings.
-   **Select Date**: Choose from available historical dates.
-   **Select Country**: Filter by US or CN.
-   **Select List**: Choose between Top Free or Top Paid.

*Note: The web interface relies on `app_rankings.json`, which is generated/updated every time the script runs.*

## Directory Structure

```text
.
├── app_downloader.ps1      # Main PowerShell script
├── index.html              # Web interface
├── app_rankings.json       # Index file for the web interface
├── app_rankings/           # Directory for ranking data
│   └── YYYYMMDD/           # Date-stamped subdirectories
│       ├── us_top-free.json
│       └── ...
├── app_details/            # Cached app details (JSON)
├── app_logos/              # Downloaded app icons (PNG)
└── .github/
    └── workflows/          # GitHub Actions configuration
```

## Automation

This repository includes a GitHub Actions workflow (`.github/workflows/update_rankings.yml`) that:
-   Runs **monthly on the 1st at 00:00 UTC**.
-   Executes the downloader script.
-   Commits and pushes the new data back to the repository.
-   Can be triggered manually via the "Run workflow" button in the GitHub Actions tab.
