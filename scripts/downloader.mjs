#!/usr/bin/env node

import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, '..');
const RANKINGS_DIR = path.join(ROOT_DIR, 'rankings');
const DETAILS_DIR = path.join(ROOT_DIR, 'details');
const LOGOS_DIR = path.join(ROOT_DIR, 'logos');
const RANKINGS_INDEX = path.join(ROOT_DIR, 'rankings.json');

const COUNTRIES = ['us', 'cn', 'jp', 'gb', 'de', 'fr'];
const FEED_CONFIGS = [
    { mediaType: 'apps', feedType: 'top-free', resource: 'apps', fileSuffix: 'top-free' },
    { mediaType: 'apps', feedType: 'top-paid', resource: 'apps', fileSuffix: 'top-paid' },
    { mediaType: 'music', feedType: 'most-played', resource: 'songs', fileSuffix: 'top-songs' },
    { mediaType: 'music', feedType: 'most-played', resource: 'albums', fileSuffix: 'top-albums' },
    { mediaType: 'podcasts', feedType: 'top', resource: 'podcasts', fileSuffix: 'top-podcasts' },
    { mediaType: 'books', feedType: 'top-free', resource: 'books', fileSuffix: 'top-free' },
    { mediaType: 'books', feedType: 'top-paid', resource: 'books', fileSuffix: 'top-paid' },
    { mediaType: 'audio-books', feedType: 'top', resource: 'audio-books', fileSuffix: 'top-audio-books' }
];

class HttpError extends Error {
    constructor(message, status, retryAfterMs = 0) {
        super(message);
        this.name = 'HttpError';
        this.status = status;
        this.retryAfterMs = retryAfterMs;
    }
}

function printHelp() {
    console.log(`Apple Top Charts downloader

Usage:
  node scripts/downloader.mjs <command> [options]

Commands:
  rank                     Download ranking RSS into rankings/YYYYMMDD/
  details                  Download lookup JSON into details/
  media                    Download artwork, generate output, and publish the index
  all                      Run rank, details, and media in order (default)

Options:
  --skip-existing          Reuse cached ranking, detail, and artwork files
  --generate-markdown      Generate Markdown summaries for ranking files
  --limit <number>         Results requested from each feed (default: 100)
  --date <YYYYMMDD>        Archive date override, useful for backfills
  -h, --help               Show this help
`);
}

function readPositiveInteger(value, optionName) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
        throw new Error(`${optionName} must be a positive integer.`);
    }
    return parsed;
}

export function parseArguments(argv) {
    const args = [...argv];
    const commands = new Set(['rank', 'details', 'media', 'all']);
    let command = 'all';

    if (args[0] && !args[0].startsWith('-')) {
        command = args.shift();
        if (!commands.has(command)) throw new Error(`Unknown command: ${command}`);
    }

    const options = {
        command,
        skipExisting: false,
        generateMarkdown: false,
        limit: 100,
        date: new Date().toISOString().slice(0, 10).replaceAll('-', ''),
        help: false
    };

    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];

        if (argument === '--skip-existing') {
            options.skipExisting = true;
        } else if (argument === '--generate-markdown') {
            options.generateMarkdown = true;
        } else if (argument === '--limit') {
            options.limit = readPositiveInteger(args[++index], '--limit');
        } else if (argument.startsWith('--limit=')) {
            options.limit = readPositiveInteger(argument.slice('--limit='.length), '--limit');
        } else if (argument === '--date') {
            options.date = args[++index];
        } else if (argument.startsWith('--date=')) {
            options.date = argument.slice('--date='.length);
        } else if (argument === '--help' || argument === '-h') {
            options.help = true;
        } else {
            throw new Error(`Unknown option: ${argument}`);
        }
    }

    if (!/^\d{8}$/.test(options.date)) {
        throw new Error('--date must use the YYYYMMDD format.');
    }

    return options;
}

function sleep(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function fileExists(filePath) {
    try {
        await access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function readJson(filePath) {
    return JSON.parse(await readFile(filePath, 'utf8'));
}

async function atomicWrite(filePath, contents) {
    await mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

    try {
        await writeFile(temporaryPath, contents);
        try {
            await rename(temporaryPath, filePath);
        } catch (error) {
            if (!['EEXIST', 'EPERM', 'ENOTEMPTY'].includes(error.code)) throw error;
            await rm(filePath, { force: true });
            await rename(temporaryPath, filePath);
        }
    } finally {
        await rm(temporaryPath, { force: true }).catch(() => {});
    }
}

function parseRetryAfter(value) {
    if (!value) return 0;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(value);
    return Number.isNaN(date) ? 0 : Math.max(0, date - Date.now());
}

async function fetchResource(url, { responseType, attempts = 3, timeoutMs = 30_000 }) {
    let lastError;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(url, {
                headers: { 'user-agent': 'apple-top-charts-archive/1.0' },
                signal: controller.signal
            });

            if (!response.ok) {
                throw new HttpError(
                    `HTTP ${response.status} ${response.statusText}`,
                    response.status,
                    parseRetryAfter(response.headers.get('retry-after'))
                );
            }

            if (responseType === 'json') {
                return JSON.parse(await response.text());
            }
            return Buffer.from(await response.arrayBuffer());
        } catch (error) {
            lastError = error;
            const retryable = !(error instanceof HttpError)
                || error.status === 408
                || error.status === 429
                || error.status >= 500;

            if (!retryable || attempt === attempts) break;

            const backoff = error.retryAfterMs
                || (2 ** (attempt - 1) * 1000) + Math.floor(Math.random() * 500);
            console.warn(`Request failed (${attempt}/${attempts}): ${url}`);
            console.warn(`Retrying in ${Math.ceil(backoff / 1000)}s: ${error.message}`);
            await sleep(backoff);
        } finally {
            clearTimeout(timeout);
        }
    }

    throw lastError;
}

async function downloadToFile(url, filePath, { responseType, skipExisting }) {
    if (skipExisting && await fileExists(filePath)) {
        if (responseType !== 'json') return { data: null, skipped: true };
        try {
            return { data: await readJson(filePath), skipped: true };
        } catch {
            console.warn(`Cached JSON is invalid and will be refreshed: ${path.relative(ROOT_DIR, filePath)}`);
        }
    }

    const data = await fetchResource(url, { responseType });
    const contents = responseType === 'json'
        ? `${JSON.stringify(data, null, 2)}\n`
        : data;
    await atomicWrite(filePath, contents);
    return { data, skipped: false };
}

export async function runSequential(items, worker) {
    const results = [];
    for (let index = 0; index < items.length; index += 1) {
        results.push(await worker(items[index], index));
    }
    return results;
}

export async function runCountryTasks(countries, worker) {
    const outcomes = await Promise.allSettled(countries.map(worker));
    const failures = outcomes.filter(outcome => outcome.status === 'rejected');
    if (failures.length > 0) {
        throw new AggregateError(
            failures.map(outcome => outcome.reason),
            `${failures.length} country task(s) failed.`
        );
    }
    return outcomes.map(outcome => outcome.value);
}

async function ensureDirectories() {
    await Promise.all([
        mkdir(RANKINGS_DIR, { recursive: true }),
        mkdir(DETAILS_DIR, { recursive: true }),
        mkdir(LOGOS_DIR, { recursive: true })
    ]);
}

async function downloadCountryRankings(country, outputDirectory, options) {
    console.log(`[rank:${country}] started`);
    const results = await runSequential(FEED_CONFIGS, async config => {
        const url = `https://rss.marketingtools.apple.com/api/v2/${country}/${config.mediaType}/${config.feedType}/${options.limit}/${config.resource}.json`;
        const fileName = `${country}_${config.mediaType}_${config.fileSuffix}.json`;
        const filePath = path.join(outputDirectory, fileName);

        try {
            const result = await downloadToFile(url, filePath, {
                responseType: 'json',
                skipExisting: options.skipExisting
            });
            console.log(`[rank:${country}] ${result.skipped ? 'cached' : 'saved'} ${fileName}`);
            return { country, filePath, data: result.data };
        } catch (error) {
            if (await fileExists(filePath)) {
                try {
                    console.warn(`[rank:${country}] using existing archive ${fileName}: ${error.message}`);
                    return { country, filePath, data: await readJson(filePath) };
                } catch {
                    // Ignore an unreadable fallback file.
                }
            }

            if (error instanceof HttpError && error.status === 404) {
                console.warn(`[rank:${country}] feed unavailable ${fileName}`);
                return null;
            }
            throw new Error(`[rank:${country}] ${fileName}: ${error.message}`, { cause: error });
        }
    });

    console.log(`[rank:${country}] completed`);
    return results.filter(Boolean);
}

async function downloadRankings(options) {
    const outputDirectory = path.join(RANKINGS_DIR, options.date);
    await mkdir(outputDirectory, { recursive: true });

    const countryResults = await runCountryTasks(
        COUNTRIES,
        country => downloadCountryRankings(country, outputDirectory, options)
    );
    const availableResults = countryResults.flat();
    if (availableResults.length === 0) {
        throw new Error('No ranking feeds could be downloaded or loaded from the archive.');
    }
    return availableResults;
}

async function loadRankingResults(date) {
    const directory = path.join(RANKINGS_DIR, date);
    if (!await fileExists(directory)) {
        throw new Error(`Ranking archive does not exist: rankings/${date}`);
    }

    const files = (await readdir(directory))
        .filter(fileName => fileName.endsWith('.json'))
        .sort();
    if (files.length === 0) {
        throw new Error(`No ranking JSON files found in rankings/${date}`);
    }

    return runSequential(files, async fileName => ({
        country: fileName.split('_')[0],
        filePath: path.join(directory, fileName),
        data: await readJson(path.join(directory, fileName))
    }));
}

function collectMediaEntries(rankingResults) {
    const entries = new Map();

    for (const ranking of rankingResults) {
        for (const item of ranking.data?.feed?.results || []) {
            const id = String(item.id || '');
            if (id && !entries.has(id)) {
                entries.set(id, { id, country: ranking.country, item });
            }
        }
    }

    return [...entries.values()];
}

function summarizeMedia(entry, lookupData) {
    const details = lookupData?.results?.[0] || {};
    return {
        id: entry.id,
        name: details.trackName || details.collectionName || details.name || entry.item.name || '',
        description: details.description || details.longDescription || '',
        artworkUrl: details.artworkUrl600
            || details.artworkUrl512
            || details.artworkUrl100
            || details.artworkUrl60
            || entry.item.artworkUrl100
            || ''
    };
}

async function downloadDetails(entries, options) {
    let completed = 0;
    const failures = [];

    const mediaItems = await runSequential(entries, async entry => {
        const filePath = path.join(DETAILS_DIR, `${entry.id}.json`);
        const url = `https://itunes.apple.com/lookup?id=${encodeURIComponent(entry.id)}&country=${encodeURIComponent(entry.country)}`;
        let lookupData = null;

        try {
            const result = await downloadToFile(url, filePath, {
                responseType: 'json',
                skipExisting: options.skipExisting
            });
            lookupData = result.data;
        } catch (error) {
            if (await fileExists(filePath)) {
                lookupData = await readJson(filePath).catch(() => null);
            }
            if (lookupData) {
                console.warn(`[details] using existing ${entry.id}: ${error.message}`);
            } else {
                console.warn(`[details] failed ${entry.id}: ${error.message}`);
                failures.push(entry.id);
            }
        }

        completed += 1;
        if (completed % 100 === 0 || completed === entries.length) {
            console.log(`[details] ${completed}/${entries.length}`);
        }
        return summarizeMedia(entry, lookupData);
    });

    if (failures.length > 0) {
        throw new Error(`Details stage incomplete: ${failures.length} item(s) failed.`);
    }
    return mediaItems;
}

async function downloadArtwork(mediaItems, options) {
    const itemsWithArtwork = mediaItems.filter(item => item.artworkUrl);
    let completed = 0;
    const failures = [];

    await runSequential(itemsWithArtwork, async item => {
        const filePath = path.join(LOGOS_DIR, `${item.id}.png`);
        try {
            await downloadToFile(item.artworkUrl, filePath, {
                responseType: 'binary',
                skipExisting: options.skipExisting
            });
        } catch (error) {
            if (await fileExists(filePath)) {
                console.warn(`[media] using existing ${item.id}: ${error.message}`);
            } else {
                console.warn(`[media] failed ${item.id}: ${error.message}`);
                failures.push(item.id);
            }
        }

        completed += 1;
        if (completed % 100 === 0 || completed === itemsWithArtwork.length) {
            console.log(`[media] ${completed}/${itemsWithArtwork.length}`);
        }
    });

    if (failures.length > 0) {
        throw new Error(`Media stage incomplete: ${failures.length} artwork file(s) failed.`);
    }
}

async function loadMediaItems(entries) {
    return runSequential(entries, async entry => {
        const filePath = path.join(DETAILS_DIR, `${entry.id}.json`);
        const lookupData = await readJson(filePath).catch(() => null);
        return summarizeMedia(entry, lookupData);
    });
}

async function listFiles(directory, predicate) {
    const found = [];
    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            found.push(...await listFiles(entryPath, predicate));
        } else if (!predicate || predicate(entryPath)) {
            found.push(entryPath);
        }
    }

    return found;
}

function createAnchor(text, fallback) {
    const anchor = String(text || '')
        .normalize('NFKD')
        .toLowerCase()
        .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
        .replace(/^-+|-+$/g, '');
    return anchor || fallback;
}

function escapeMarkdown(text) {
    return String(text || '').replaceAll('[', '\\[').replaceAll(']', '\\]');
}

async function generateMarkdownFiles(date) {
    const archiveDirectory = path.join(RANKINGS_DIR, date);
    const rankingFiles = (await listFiles(archiveDirectory, file => file.endsWith('.json'))).sort();
    const detailsCache = new Map();

    for (const rankingFile of rankingFiles) {
        const ranking = await readJson(rankingFile);
        const results = ranking.feed?.results || [];
        const toc = [];
        const sections = [];

        for (const item of results) {
            const id = String(item.id || '');
            if (!id) continue;

            if (!detailsCache.has(id)) {
                const detailPath = path.join(DETAILS_DIR, `${id}.json`);
                detailsCache.set(id, await readJson(detailPath).catch(() => null));
            }

            const details = detailsCache.get(id)?.results?.[0] || {};
            const title = details.trackName || details.collectionName || item.name || id;
            const description = details.description || details.longDescription || '';
            const anchor = createAnchor(title, id);
            const logoPath = path.relative(
                path.dirname(rankingFile),
                path.join(LOGOS_DIR, `${id}.png`)
            ).split(path.sep).join('/');

            toc.push(`- [${escapeMarkdown(title)}](#${anchor})`);
            sections.push([
                `<a id="${anchor}"></a>`,
                `## ${title}`,
                '',
                `![${escapeMarkdown(title)}](${logoPath})`,
                '',
                description,
                '',
                item.url ? `[View on Apple](${item.url})` : ''
            ].filter((line, index, lines) => line || (index > 0 && lines[index - 1])).join('\n'));
        }

        const markdownPath = rankingFile.replace(/\.json$/i, '.md');
        await atomicWrite(markdownPath, `${toc.join('\n')}\n\n${sections.join('\n\n')}\n`);
    }

    console.log(`[markdown] generated ${rankingFiles.length} files`);
}

async function rebuildRankingsIndex() {
    const files = (await listFiles(RANKINGS_DIR, file => file.endsWith('.json'))).sort();
    const index = await Promise.all(files.map(async filePath => {
        const fileStat = await stat(filePath);
        return {
            Name: path.basename(filePath),
            RelativePath: path.relative(ROOT_DIR, filePath).split(path.sep).join('/'),
            LastWriteTime: fileStat.mtime.toISOString(),
            Length: fileStat.size
        };
    }));

    await atomicWrite(RANKINGS_INDEX, `${JSON.stringify(index, null, 2)}\n`);
    console.log(`[index] wrote ${index.length} ranking files`);
}

export async function runRankStage(options) {
    console.log('[stage 1/3] Downloading ranking RSS...');
    const results = await downloadRankings(options);
    console.log(`[stage 1/3] Complete: ${results.length} ranking feed(s).`);
}

export async function runDetailsStage(options) {
    console.log('[stage 2/3] Downloading detail JSON...');
    const rankings = await loadRankingResults(options.date);
    const entries = collectMediaEntries(rankings);
    await downloadDetails(entries, options);
    console.log(`[stage 2/3] Complete: ${entries.length} unique media item(s).`);
}

export async function runMediaStage(options) {
    console.log('[stage 3/3] Downloading media files...');
    const rankings = await loadRankingResults(options.date);
    const entries = collectMediaEntries(rankings);
    const mediaItems = await loadMediaItems(entries);
    await downloadArtwork(mediaItems, options);

    if (options.generateMarkdown) await generateMarkdownFiles(options.date);
    else console.log('[markdown] skipped');

    await rebuildRankingsIndex();
    console.log(`[stage 3/3] Complete: ${mediaItems.length} media item(s); rankings.json published.`);
}

export async function main(argv = process.argv.slice(2)) {
    const options = parseArguments(argv);
    if (options.help) {
        printHelp();
        return;
    }

    console.log(`Command: ${options.command}; archive date: ${options.date}`);
    console.log(`Limit: ${options.limit}; skip existing: ${options.skipExisting}`);
    await ensureDirectories();

    if (options.command === 'rank' || options.command === 'all') {
        await runRankStage(options);
    }
    if (options.command === 'details' || options.command === 'all') {
        await runDetailsStage(options);
    }
    if (options.command === 'media' || options.command === 'all') {
        await runMediaStage(options);
    }
    console.log('Done.');
}

const isMain = process.argv[1]
    && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
    main().catch(error => {
        console.error(error.stack || error.message || error);
        process.exitCode = 1;
    });
}
