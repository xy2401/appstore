import assert from 'node:assert/strict';
import test from 'node:test';

import { mapWithConcurrency, parseArguments } from './downloader.mjs';

test('parseArguments applies defaults and supported flags', () => {
    const options = parseArguments([
        '--skip-existing',
        '--generate-markdown',
        '--limit', '50',
        '--concurrency=2',
        '--date', '20260701'
    ]);

    assert.equal(options.skipExisting, true);
    assert.equal(options.generateMarkdown, true);
    assert.equal(options.limit, 50);
    assert.equal(options.concurrency, 2);
    assert.equal(options.date, '20260701');
});

test('parseArguments rejects invalid values and unknown flags', () => {
    assert.throws(() => parseArguments(['--limit', '0']), /positive integer/);
    assert.throws(() => parseArguments(['--date', '2026-07-01']), /YYYYMMDD/);
    assert.throws(() => parseArguments(['--unknown']), /Unknown option/);
});

test('mapWithConcurrency preserves order and respects the limit', async () => {
    let active = 0;
    let maximumActive = 0;

    const result = await mapWithConcurrency([1, 2, 3, 4], 2, async value => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise(resolve => setTimeout(resolve, 5));
        active -= 1;
        return value * 2;
    });

    assert.deepEqual(result, [2, 4, 6, 8]);
    assert.equal(maximumActive, 2);
});
