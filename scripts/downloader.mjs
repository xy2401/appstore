#!/usr/bin/env node

import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, '..');
const RANKINGS_DIR = path.join(ROOT_DIR, 'rankings');
const DETAILS_DIR = path.join(ROOT_DIR, 'details');
const LOGOS_DIR = path.join(ROOT_DIR, 'logos');
const LISTS_DIR = path.join(ROOT_DIR, 'lists');
const RANKINGS_INDEX = path.join(ROOT_DIR, 'rankings.json');
const DETAIL_BATCH_SIZE = 25;
const LOOKUP_MIN_INTERVAL_MS = 3_250;
const LOOKUP_RATE_LIMIT_DELAYS_MS = [30_000, 60_000];

const COUNTRIES = ['us', 'cn', 'jp', 'gb', 'de', 'fr'];
const FEED_CONFIGS = [
    { mediaType: 'apps', feedType: 'top-free', resource: 'apps', fileSuffix: 'top-free' },
    { mediaType: 'apps', feedType: 'top-paid', resource: 'apps', fileSuffix: 'top-paid' },
    { mediaType: 'music', feedType: 'most-played', resource: 'songs', fileSuffix: 'top-songs' },
    { mediaType: 'music', feedType: 'most-played', resource: 'albums', fileSuffix: 'top-albums' },
    { mediaType: 'music', feedType: 'most-played', resource: 'music-videos', fileSuffix: 'top-music-videos' },
    { mediaType: 'music', feedType: 'most-played', resource: 'playlists', fileSuffix: 'top-playlists' },
    { mediaType: 'podcasts', feedType: 'top', resource: 'podcasts', fileSuffix: 'top-podcasts' },
    { mediaType: 'podcasts', feedType: 'top-subscriber', resource: 'podcasts', fileSuffix: 'top-subscriber-podcasts', countries: ['us', 'gb'] },
    { mediaType: 'podcasts', feedType: 'top', resource: 'podcast-episodes', fileSuffix: 'top-podcast-episodes' },
    { mediaType: 'podcasts', feedType: 'top-subscriber', resource: 'podcast-channels', fileSuffix: 'top-subscriber-podcast-channels', countries: ['us', 'gb'] },
    { mediaType: 'books', feedType: 'top-free', resource: 'books', fileSuffix: 'top-free' },
    { mediaType: 'books', feedType: 'top-paid', resource: 'books', fileSuffix: 'top-paid' },
    { mediaType: 'audio-books', feedType: 'top', resource: 'audio-books', fileSuffix: 'top-audio-books' }
];

export function getFeedConfigsForCountry(country) {
    return FEED_CONFIGS.filter(config => !config.countries || config.countries.includes(country));
}

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
  lists                    Download details and artwork only for curated lists
  all                      Run rank, details, and media in order (default)

Options:
  --skip-existing          Reuse cached ranking and detail JSON files
  --generate-markdown      Generate Markdown summaries for ranking files
  --limit <number>         Results requested from each feed (default: 100)
  --countries <list>       Countries separated by commas or spaces (default: all)
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

function parseCountries(value) {
    const countries = String(value || '')
        .toLowerCase()
        .split(/[\s,]+/)
        .filter(Boolean);
    const invalidCountries = countries.filter(country => !COUNTRIES.includes(country));

    if (countries.length === 0) {
        throw new Error('--countries must include at least one country code.');
    }
    if (invalidCountries.length > 0) {
        throw new Error(
            `Unsupported countries: ${[...new Set(invalidCountries)].join(', ')}. `
            + `Supported values: ${COUNTRIES.join(', ')}.`
        );
    }
    return [...new Set(countries)];
}

export function parseArguments(argv) {
    const args = [...argv];
    const commands = new Set(['rank', 'details', 'media', 'lists', 'all']);
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
        countries: [...COUNTRIES],
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
        } else if (argument === '--countries') {
            const values = [];
            while (args[index + 1] && !args[index + 1].startsWith('-')) {
                values.push(args[++index]);
            }
            options.countries = parseCountries(values.join(' '));
        } else if (argument.startsWith('--countries=')) {
            options.countries = parseCountries(argument.slice('--countries='.length));
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

export function hashArtworkUrl(url) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < url.length; index += 1) {
        hash ^= url.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

export function getArtworkFileName(id, artworkUrl) {
    return `${id}-${hashArtworkUrl(artworkUrl)}.png`;
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

    if (lastError && !lastError.requestUrl) {
        lastError.requestUrl = url;
        lastError.message = `${lastError.message}; URL: ${url}`;
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
    const outcomes = await Promise.allSettled(
        countries.map((country, index) => worker(country, index))
    );
    const failures = [];
    const successes = [];

    outcomes.forEach((outcome, index) => {
        if (outcome.status === 'fulfilled') {
            successes.push(outcome.value);
            return;
        }

        const country = countries[index];
        failures.push({ country, reason: outcome.reason });
        console.warn(
            `[rank:${country}] failed; continuing with other countries: `
            + (outcome.reason?.message || outcome.reason)
        );
    });

    if (failures.length > 0) {
        console.warn(
            `[rank] ${failures.length} country task(s) failed (${failures.map(failure => failure.country).join(', ')}); `
            + `continuing with ${successes.length} successful country task(s).`
        );
    }

    return successes;
}

async function ensureDirectories() {
    await Promise.all([
        mkdir(RANKINGS_DIR, { recursive: true }),
        mkdir(DETAILS_DIR, { recursive: true }),
        mkdir(LOGOS_DIR, { recursive: true }),
        mkdir(LISTS_DIR, { recursive: true })
    ]);
}

async function downloadCountryRankings(country, outputDirectory, options) {
    console.log(`[rank:${country}] started`);
    const results = await runSequential(getFeedConfigsForCountry(country), async config => {
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

    await runCountryTasks(
        options.countries,
        country => downloadCountryRankings(country, outputDirectory, options)
    );

    try {
        return await loadRankingResults(options.date, options.countries);
    } catch (error) {
        throw new Error('No readable ranking feeds are available after all country tasks finished.', {
            cause: error
        });
    }
}

async function loadRankingResults(date, countries = COUNTRIES) {
    const directory = path.join(RANKINGS_DIR, date);
    if (!await fileExists(directory)) {
        throw new Error(`Ranking archive does not exist: rankings/${date}`);
    }

    const files = (await readdir(directory))
        .filter(fileName => (
            fileName.endsWith('.json')
            && countries.includes(fileName.split('_')[0])
        ))
        .sort();
    if (files.length === 0) {
        throw new Error(
            `No ranking JSON files found in rankings/${date} for ${countries.join(', ')}.`
        );
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
            if (!id) continue;

            const artworkUrl = item.artworkUrl100 || item.artworkUrl60 || '';
            if (!entries.has(id)) {
                entries.set(id, { id, country: ranking.country, item, artworkUrls: [] });
            }

            const entry = entries.get(id);
            if (artworkUrl && !entry.artworkUrls.includes(artworkUrl)) {
                entry.artworkUrls.push(artworkUrl);
            }
        }
    }

    return [...entries.values()];
}

async function loadCuratedLists(countries = COUNTRIES) {
    const files = (await readdir(LISTS_DIR))
        .filter(fileName => fileName.endsWith('-apps.json'))
        .sort();
    const lists = [];

    for (const fileName of files) {
        const list = await readJson(path.join(LISTS_DIR, fileName));
        const country = String(list.country || 'us').toLowerCase();
        if (!countries.includes(country)) continue;
        lists.push({ ...list, country, fileName });
    }

    return lists;
}

export function createCuratedEntries(lists) {
    const entries = [];

    for (const list of lists) {
        const country = String(list.country || 'us').toLowerCase();
        for (const value of list.ids || []) {
            const id = String(value || '');
            if (!id) continue;
            entries.push({
                id,
                country,
                item: { id, kind: list.mediaType || 'apps' },
                artworkUrls: []
            });
        }
    }

    return entries;
}

export function mergeMediaEntries(...entryGroups) {
    const entries = new Map();

    for (const group of entryGroups) {
        for (const entry of group) {
            if (!entries.has(entry.id)) {
                entries.set(entry.id, {
                    ...entry,
                    item: { ...entry.item },
                    artworkUrls: [...entry.artworkUrls]
                });
                continue;
            }

            const existing = entries.get(entry.id);
            existing.item = { ...entry.item, ...existing.item };
            for (const artworkUrl of entry.artworkUrls) {
                if (!existing.artworkUrls.includes(artworkUrl)) {
                    existing.artworkUrls.push(artworkUrl);
                }
            }
        }
    }

    return [...entries.values()];
}

async function loadAllMediaEntries(options) {
    const rankings = await loadRankingResults(options.date, options.countries);
    const lists = await loadCuratedLists(options.countries);
    return mergeMediaEntries(
        collectMediaEntries(rankings),
        createCuratedEntries(lists)
    );
}

function summarizeMedia(entry, lookupData) {
    const details = lookupData?.results?.[0] || {};
    const artworkUrl = details.artworkUrl600
        || details.artworkUrl512
        || details.artworkUrl100
        || details.artworkUrl60
        || entry.item.artworkUrl100
        || entry.item.artworkUrl60
        || '';

    return {
        id: entry.id,
        name: details.trackName || details.collectionName || details.name || entry.item.name || '',
        description: details.description || details.longDescription || '',
        artworkUrl,
        versionArtworkUrls: entry.artworkUrls.length > 0
            ? entry.artworkUrls
            : artworkUrl ? [artworkUrl] : []
    };
}

export function createRequestThrottle(
    minIntervalMs = LOOKUP_MIN_INTERVAL_MS,
    { now = Date.now, wait = sleep } = {}
) {
    let lastStartedAt = null;

    return async function waitForRequestSlot() {
        if (lastStartedAt !== null) {
            const waitMs = Math.max(0, minIntervalMs - (now() - lastStartedAt));
            if (waitMs > 0) await wait(waitMs);
        }
        lastStartedAt = now();
    };
}

export function createDetailBatches(entries, batchSize = DETAIL_BATCH_SIZE) {
    const entriesByCountry = new Map();

    for (const entry of entries) {
        if (!entriesByCountry.has(entry.country)) entriesByCountry.set(entry.country, []);
        entriesByCountry.get(entry.country).push(entry);
    }

    const batches = [];
    for (const countryEntries of entriesByCountry.values()) {
        for (let index = 0; index < countryEntries.length; index += batchSize) {
            batches.push(countryEntries.slice(index, index + batchSize));
        }
    }
    return batches;
}

export function isLookupCompatibleId(id) {
    return /^\d+$/.test(String(id));
}

function getPrimaryLookupResultId(result) {
    if (result.wrapperType === 'collection' && result.collectionId != null) {
        return String(result.collectionId);
    }
    if (result.wrapperType === 'artist' && result.artistId != null) {
        return String(result.artistId);
    }
    return String(result.trackId ?? result.collectionId ?? result.artistId ?? '');
}

export function splitLookupResults(entries, lookupData) {
    const requestedIds = new Set(entries.map(entry => String(entry.id)));
    const resultsById = new Map();

    for (const result of lookupData?.results || []) {
        const candidateIds = [
            getPrimaryLookupResultId(result),
            result.trackId,
            result.collectionId,
            result.artistId
        ].filter(value => value !== undefined && value !== null && value !== '')
            .map(String);
        const id = candidateIds.find(candidateId => requestedIds.has(candidateId));
        if (id && !resultsById.has(id)) resultsById.set(id, result);
    }

    return resultsById;
}

async function downloadSingleDetail(entry, options) {
    const filePath = path.join(DETAILS_DIR, `${entry.id}.json`);
    const url = `https://itunes.apple.com/lookup?id=${encodeURIComponent(entry.id)}&country=${encodeURIComponent(entry.country)}`;
    let lookupData = null;
    let failed = false;

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
        if (lookupData) console.warn(`[details] using existing ${entry.id}: ${error.message}`);
        else {
            console.warn(`[details] failed ${entry.id}: ${error.message}`);
            failed = true;
        }
    }

    return { lookupData, failed };
}

async function fetchDetailBatch(entries, waitForRequestSlot) {
    const country = entries[0].country;
    const ids = entries.map(entry => entry.id).join(',');
    const url = `https://itunes.apple.com/lookup?id=${ids}&country=${encodeURIComponent(country)}`;
    let retryDelayMs = 0;
    let lastError;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
        if (retryDelayMs > 0) await sleep(retryDelayMs);
        await waitForRequestSlot();

        try {
            return await fetchResource(url, { responseType: 'json', attempts: 1 });
        } catch (error) {
            lastError = error;
            const rateLimited = error instanceof HttpError
                && (error.status === 403 || error.status === 429);
            const retryable = !(error instanceof HttpError)
                || rateLimited
                || error.status === 408
                || error.status >= 500;

            if (!retryable || attempt === 3) break;

            retryDelayMs = error.retryAfterMs
                || (rateLimited
                    ? LOOKUP_RATE_LIMIT_DELAYS_MS[attempt - 1]
                    : (2 ** (attempt - 1)) * 1000);
            console.warn(
                `[details:${country}] batch request failed (${attempt}/3); `
                + `retrying in ${Math.ceil(retryDelayMs / 1000)}s: ${error.message}`
            );
        }
    }

    throw lastError;
}

async function saveDetailBatch(entries, lookupData) {
    const resultsById = splitLookupResults(entries, lookupData);

    for (const entry of entries) {
        const filePath = path.join(DETAILS_DIR, `${entry.id}.json`);
        const result = resultsById.get(String(entry.id));
        if (result) {
            await atomicWrite(filePath, `${JSON.stringify({ resultCount: 1, results: [result] }, null, 2)}\n`);
            continue;
        }

        const existing = await readJson(filePath).catch(() => null);
        if (existing) {
            console.warn(`[details] lookup omitted ${entry.id}; keeping existing file`);
        } else {
            await atomicWrite(filePath, `${JSON.stringify({ resultCount: 0, results: [] }, null, 2)}\n`);
            console.warn(`[details] lookup returned no result for ${entry.id}`);
        }
    }
}

async function downloadDetails(entries, options) {
    let completed = 0;
    let nextProgress = 100;
    let lastReported = -1;
    const failures = [];
    const pendingEntries = [];
    const waitForRequestSlot = createRequestThrottle();

    const reportProgress = force => {
        if (completed === lastReported) return;
        if (!force && completed < nextProgress) return;
        console.log(`[details] ${completed}/${entries.length}`);
        lastReported = completed;
        while (nextProgress <= completed) nextProgress += 100;
    };

    for (const entry of entries) {
        const filePath = path.join(DETAILS_DIR, `${entry.id}.json`);
        const cached = options.skipExisting
            ? await readJson(filePath).catch(() => null)
            : null;
        if (cached) {
            completed += 1;
        } else if (!isLookupCompatibleId(entry.id)) {
            const existing = await readJson(filePath).catch(() => null);
            if (!existing) {
                await atomicWrite(
                    filePath,
                    `${JSON.stringify({ resultCount: 0, results: [] }, null, 2)}\n`
                );
            }
            console.warn(
                `[details] Lookup API does not accept ${entry.id}; using ranking metadata only`
            );
            completed += 1;
        } else {
            pendingEntries.push(entry);
        }
    }

    reportProgress(false);

    for (const batch of createDetailBatches(pendingEntries)) {
        try {
            const lookupData = await fetchDetailBatch(batch, waitForRequestSlot);
            await saveDetailBatch(batch, lookupData);
        } catch (error) {
            const uncachedIds = [];
            for (const entry of batch) {
                const filePath = path.join(DETAILS_DIR, `${entry.id}.json`);
                const existing = await readJson(filePath).catch(() => null);
                if (!existing) uncachedIds.push(entry.id);
            }

            if (uncachedIds.length > 0) {
                failures.push(...uncachedIds);
                console.warn(
                    `[details:${batch[0].country}] batch failed without cache for `
                    + `${uncachedIds.join(', ')}: ${error.message}`
                );
            } else {
                console.warn(
                    `[details:${batch[0].country}] batch failed; using existing files: ${error.message}`
                );
            }
        }

        completed += batch.length;
        reportProgress(false);
    }

    reportProgress(true);

    if (failures.length > 0) {
        throw new Error(`Details stage incomplete: ${failures.length} item(s) failed.`);
    }
}

async function downloadArtwork(mediaItems) {
    const itemsWithArtwork = mediaItems.filter(
        item => item.artworkUrl && item.versionArtworkUrls.length > 0
    );
    let completed = 0;
    const failures = [];

    await runSequential(itemsWithArtwork, async item => {
        const stableFilePath = path.join(LOGOS_DIR, `${item.id}.png`);
        const versionFilePaths = item.versionArtworkUrls.map(artworkUrl => (
            path.join(LOGOS_DIR, getArtworkFileName(item.id, artworkUrl))
        ));
        const missingVersionPaths = [];

        for (const filePath of versionFilePaths) {
            if (!await fileExists(filePath)) missingVersionPaths.push(filePath);
        }

        try {
            let artworkData;
            if (missingVersionPaths.length > 0) {
                const primaryVersionPath = missingVersionPaths[0];
                await downloadToFile(item.artworkUrl, primaryVersionPath, {
                    responseType: 'binary',
                    skipExisting: false
                });
                artworkData = await readFile(primaryVersionPath);

                await Promise.all(missingVersionPaths.slice(1).map(
                    filePath => atomicWrite(filePath, artworkData)
                ));
                await atomicWrite(stableFilePath, artworkData);
                console.log(`[media] saved ${path.basename(primaryVersionPath)}`);
            } else if (!await fileExists(stableFilePath)) {
                artworkData = await readFile(versionFilePaths[0]);
                await atomicWrite(stableFilePath, artworkData);
                console.log(`[media] restored ${item.id}.png`);
            }
        } catch (error) {
            if (await fileExists(stableFilePath)) {
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

async function generateMarkdownFiles(date, countries = COUNTRIES) {
    const archiveDirectory = path.join(RANKINGS_DIR, date);
    const rankingFiles = (await listFiles(archiveDirectory, file => (
        file.endsWith('.json')
        && countries.includes(path.basename(file).split('_')[0])
    ))).sort();
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
            const versionArtworkUrl = item.artworkUrl100 || item.artworkUrl60 || '';
            const versionLogoPath = versionArtworkUrl
                ? path.join(LOGOS_DIR, getArtworkFileName(id, versionArtworkUrl))
                : '';
            const logoFilePath = versionLogoPath && await fileExists(versionLogoPath)
                ? versionLogoPath
                : path.join(LOGOS_DIR, `${id}.png`);
            const logoPath = path.relative(
                path.dirname(rankingFile),
                logoFilePath
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
    const entries = await loadAllMediaEntries(options);
    await downloadDetails(entries, options);
    console.log(`[stage 2/3] Complete: ${entries.length} unique media item(s).`);
}

export async function runMediaStage(options) {
    console.log('[stage 3/3] Downloading media files...');
    const entries = await loadAllMediaEntries(options);
    const mediaItems = await loadMediaItems(entries);
    await downloadArtwork(mediaItems);

    if (options.generateMarkdown) await generateMarkdownFiles(options.date, options.countries);
    else console.log('[markdown] skipped');

    await rebuildRankingsIndex();
    console.log(`[stage 3/3] Complete: ${mediaItems.length} media item(s); rankings.json published.`);
}

export async function runListsStage(options) {
    console.log('[lists] Downloading curated app details and media...');
    const lists = await loadCuratedLists(options.countries);
    const entries = createCuratedEntries(lists);
    await downloadDetails(entries, options);
    const mediaItems = await loadMediaItems(entries);
    await downloadArtwork(mediaItems);
    console.log(`[lists] Complete: ${lists.length} list(s); ${mediaItems.length} app(s).`);
}

export async function main(argv = process.argv.slice(2)) {
    const options = parseArguments(argv);
    if (options.help) {
        printHelp();
        return;
    }

    console.log(`Command: ${options.command}; archive date: ${options.date}`);
    console.log(`Limit: ${options.limit}; skip existing: ${options.skipExisting}`);
    console.log(`Countries: ${options.countries.join(', ')}`);
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
    if (options.command === 'lists') {
        await runListsStage(options);
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
