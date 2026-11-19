'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { aggregateHits } = require('../routes/ruleHitsReport');

function keywordRow(name, expression, score, hitCount, updatedAt) {
    return {
        rule_type: 'blacklist.keywordFilters',
        rule_value: JSON.stringify({ FilterName: name, FilterExpression: expression, Score: score }),
        hit_count: hitCount,
        updated_at: updatedAt
    };
}

test('aggregateHits merges keyword rows with the same FilterName and sums their hits', () => {
    const first = keywordRow('SPAM_WORD', 'viagra', 5, 3, '2026-11-01T00:00:00Z');
    const second = keywordRow('SPAM_WORD', 'cialis', 10, 7, '2026-11-02T00:00:00Z');

    const result = aggregateHits([first, second]);

    assert.equal(result.length, 1);
    assert.equal(result[0].rule_type, 'blacklist.keywordFilters');
    assert.equal(result[0].display_label, 'SPAM_WORD');
    assert.equal(result[0].hit_count, 10);
    assert.deepEqual(result[0].entries, [
        { rule_type: first.rule_type, rule_value: first.rule_value },
        { rule_type: second.rule_type, rule_value: second.rule_value }
    ]);
});

test('aggregateHits lists distinct scores in numeric order', () => {
    const result = aggregateHits([
        keywordRow('SPAM_WORD', 'a', 10, 1, '2026-11-01T00:00:00Z'),
        keywordRow('SPAM_WORD', 'b', 2, 1, '2026-11-01T00:00:00Z'),
        keywordRow('SPAM_WORD', 'c', 10, 1, '2026-11-01T00:00:00Z'),
        keywordRow('SPAM_WORD', 'd', 5, 1, '2026-11-01T00:00:00Z')
    ]);

    assert.deepEqual(result[0].scores, ['2', '5', '10']);
});

test('aggregateHits omits zero and missing scores from the score list', () => {
    const result = aggregateHits([
        keywordRow('SPAM_WORD', 'a', 0, 1, '2026-11-01T00:00:00Z'),
        keywordRow('SPAM_WORD', 'b', 5, 1, '2026-11-01T00:00:00Z')
    ]);

    assert.deepEqual(result[0].scores, ['5']);
});

test('aggregateHits keeps keyword rows with different FilterNames separate', () => {
    const result = aggregateHits([
        keywordRow('SPAM_WORD', 'a', 5, 2, '2026-11-01T00:00:00Z'),
        keywordRow('PHISH', 'b', 5, 4, '2026-11-01T00:00:00Z')
    ]);

    assert.equal(result.length, 2);
    assert.deepEqual(result.map(row => row.display_label).sort(), ['PHISH', 'SPAM_WORD']);
});

test('aggregateHits does not merge keyword rows that have no FilterName', () => {
    const result = aggregateHits([
        keywordRow('', 'foo bar', 5, 1, '2026-11-01T00:00:00Z'),
        keywordRow('', 'baz qux', 5, 1, '2026-11-01T00:00:00Z')
    ]);

    assert.equal(result.length, 2);
});

test('aggregateHits leaves non-keyword rows with different values separate', () => {
    const result = aggregateHits([
        { rule_type: 'blacklist.senders', rule_value: 'a@example.com', hit_count: 2, updated_at: '2026-11-01T00:00:00Z' },
        { rule_type: 'blacklist.senders', rule_value: 'b@example.com', hit_count: 3, updated_at: '2026-11-01T00:00:00Z' }
    ]);

    assert.equal(result.length, 2);
});

test('aggregateHits keeps identical names under different rule types separate', () => {
    const result = aggregateHits([
        { rule_type: 'whitelist.senders', rule_value: 'a@example.com', hit_count: 2, updated_at: '2026-11-01T00:00:00Z' },
        { rule_type: 'blacklist.senders', rule_value: 'a@example.com', hit_count: 3, updated_at: '2026-11-01T00:00:00Z' }
    ]);

    assert.equal(result.length, 2);
});

test('aggregateHits uses the newest update time for a merged row', () => {
    const result = aggregateHits([
        keywordRow('SPAM_WORD', 'a', 5, 1, '2026-11-01T00:00:00Z'),
        keywordRow('SPAM_WORD', 'b', 10, 1, '2026-11-05T00:00:00Z')
    ]);

    assert.equal(result[0].updated_at, '2026-11-05T00:00:00Z');
});
