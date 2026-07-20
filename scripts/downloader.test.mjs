import assert from 'node:assert/strict';
import test from 'node:test';

import { parseArguments, runCountryTasks, runSequential } from './downloader.mjs';

test('parseArguments applies defaults and supported flags', () => {
    const options = parseArguments([
        'details',
        '--skip-existing',
        '--generate-markdown',
        '--limit', '50',
        '--date', '20260701'
    ]);

    assert.equal(options.command, 'details');
    assert.equal(options.skipExisting, true);
    assert.equal(options.generateMarkdown, true);
    assert.equal(options.limit, 50);
    assert.equal(options.date, '20260701');
});

test('parseArguments defaults to the all command', () => {
    assert.equal(parseArguments([]).command, 'all');
});

test('parseArguments rejects invalid values and unknown flags', () => {
    assert.throws(() => parseArguments(['--limit', '0']), /positive integer/);
    assert.throws(() => parseArguments(['--date', '2026-07-01']), /YYYYMMDD/);
    assert.throws(() => parseArguments(['--unknown']), /Unknown option/);
    assert.throws(() => parseArguments(['unknown']), /Unknown command/);
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

test('runCountryTasks rejects the stage after all country tasks settle', async () => {
    const completed = [];

    await assert.rejects(
        runCountryTasks(['us', 'cn', 'jp'], async country => {
            await new Promise(resolve => setTimeout(resolve, country === 'cn' ? 1 : 5));
            completed.push(country);
            if (country === 'cn') throw new Error('country failed');
            return country;
        }),
        error => error instanceof AggregateError && /1 country task/.test(error.message)
    );

    assert.deepEqual(completed.sort(), ['cn', 'jp', 'us']);
});
