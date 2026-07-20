import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createDetailBatches,
    createRequestThrottle,
    getArtworkFileName,
    hashArtworkUrl,
    parseArguments,
    runCountryTasks,
    runSequential,
    splitLookupResults
} from './downloader.mjs';

test('parseArguments applies defaults and supported flags', () => {
    const options = parseArguments([
        'details',
        '--skip-existing',
        '--generate-markdown',
        '--limit', '50',
        '--countries', 'cn, jp',
        '--date', '20260701'
    ]);

    assert.equal(options.command, 'details');
    assert.equal(options.skipExisting, true);
    assert.equal(options.generateMarkdown, true);
    assert.equal(options.limit, 50);
    assert.deepEqual(options.countries, ['cn', 'jp']);
    assert.equal(options.date, '20260701');
});

test('parseArguments defaults to the all command', () => {
    const options = parseArguments([]);
    assert.equal(options.command, 'all');
    assert.deepEqual(options.countries, ['us', 'cn', 'jp', 'gb', 'de', 'fr']);
});

test('parseArguments rejects invalid values and unknown flags', () => {
    assert.throws(() => parseArguments(['--limit', '0']), /positive integer/);
    assert.throws(() => parseArguments(['--date', '2026-07-01']), /YYYYMMDD/);
    assert.throws(() => parseArguments(['--countries']), /at least one/);
    assert.throws(() => parseArguments(['--countries', 'cn', 'ca']), /Unsupported countries: ca/);
    assert.throws(() => parseArguments(['--unknown']), /Unknown option/);
    assert.throws(() => parseArguments(['unknown']), /Unknown command/);
});

test('parseArguments accepts comma and unquoted space-separated countries', () => {
    assert.deepEqual(parseArguments(['--countries=US,CN']).countries, ['us', 'cn']);
    assert.deepEqual(parseArguments(['--countries', 'jp', 'gb', 'de']).countries, ['jp', 'gb', 'de']);
});

test('runSequential processes one item at a time and preserves order', async () => {
    let active = 0;
    let maximumActive = 0;

    const result = await runSequential([1, 2, 3, 4], async value => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise(resolve => setTimeout(resolve, 5));
        active -= 1;
        return value * 2;
    });

    assert.deepEqual(result, [2, 4, 6, 8]);
    assert.equal(maximumActive, 1);
});

test('runCountryTasks runs countries concurrently', async () => {
    let active = 0;
    let maximumActive = 0;
    const countries = ['us', 'cn', 'jp', 'gb', 'de', 'fr'];

    const result = await runCountryTasks(countries, async country => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise(resolve => setTimeout(resolve, 5));
        active -= 1;
        return country.toUpperCase();
    });

    assert.deepEqual(result, countries.map(country => country.toUpperCase()));
    assert.equal(maximumActive, countries.length);
});

test('runCountryTasks keeps successful results after all country tasks settle', async () => {
    const completed = [];

    const result = await runCountryTasks(['us', 'cn', 'jp'], async country => {
        await new Promise(resolve => setTimeout(resolve, country === 'cn' ? 1 : 5));
        completed.push(country);
        if (country === 'cn') throw new Error('country failed');
        return country;
    });

    assert.deepEqual(completed.sort(), ['cn', 'jp', 'us']);
    assert.deepEqual(result, ['us', 'jp']);
});

test('artwork filenames include a stable short URL hash', () => {
    assert.equal(hashArtworkUrl('hello'), '4f9f2cab');
    assert.equal(getArtworkFileName('42', 'hello'), '42-4f9f2cab.png');
});

test('detail batches preserve countries and enforce the requested size', () => {
    const entries = [
        ...Array.from({ length: 26 }, (_, index) => ({ id: `us-${index}`, country: 'us' })),
        { id: 'jp-1', country: 'jp' }
    ];
    const batches = createDetailBatches(entries, 25);

    assert.deepEqual(batches.map(batch => batch.length), [25, 1, 1]);
    assert.deepEqual(batches.map(batch => [...new Set(batch.map(entry => entry.country))]), [
        ['us'],
        ['us'],
        ['jp']
    ]);
});

test('lookup batch results split into the existing per-ID format', () => {
    const app = { wrapperType: 'software', trackId: 100, trackName: 'App' };
    const album = { wrapperType: 'collection', collectionId: 200, collectionName: 'Album' };
    const results = splitLookupResults(
        [{ id: '100' }, { id: '200' }, { id: '300' }],
        { resultCount: 2, results: [app, album] }
    );

    assert.equal(results.get('100'), app);
    assert.equal(results.get('200'), album);
    assert.equal(results.has('300'), false);
});

test('request throttle enforces a minimum start-to-start interval', async () => {
    let now = 1_000;
    const waits = [];
    const waitForRequestSlot = createRequestThrottle(3_250, {
        now: () => now,
        wait: async milliseconds => {
            waits.push(milliseconds);
            now += milliseconds;
        }
    });

    await waitForRequestSlot();
    now += 1_000;
    await waitForRequestSlot();
    now += 4_000;
    await waitForRequestSlot();

    assert.deepEqual(waits, [2_250]);
});
