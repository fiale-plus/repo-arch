import * as assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as childProcess from 'node:child_process';
import { generateQueries, runEval, formatEval } from '../src/eval.js';
import type { InsightCard } from '../src/cards.js';

function makeCard(overrides: Partial<InsightCard>): InsightCard {
  return {
    id: 'test-card-00000001',
    type: 'repeated-fix',
    title: 'Repeated fixes in: src/core.ts',
    confidence: 0.7,
    status: 'accepted',
    supportingCommits: [{ sha: 'abc123', subject: 'fix crash in core' }],
    affectedFiles: ['src/core.ts'],
    suggestion: 'This file was fixed 2 times. Consider adding regression tests.',
    ...overrides,
  };
}

test('generateQueries creates queries from accepted cards', () => {
  const cards = [
    makeCard({ id: 'card-a', status: 'accepted', title: 'High-churn file: src/hot.ts' }),
    makeCard({ id: 'card-b', status: 'pending', title: 'Test gap: src/foo.ts' }),
  ];
  const queries = generateQueries(cards);
  assert.equal(queries.length, 2, 'only accepted card generates queries');
  assert.ok(queries.every(q => q.expectedCardId === 'card-a'));
});

test('generateQueries creates title and suggestion queries', () => {
  const cards = [makeCard({ id: 'card-a', status: 'accepted', title: 'Test card', suggestion: 'Consider adding tests for this module' })];
  const queries = generateQueries(cards);
  assert.equal(queries.length, 2);
  assert.ok(queries.some(q => q.query === 'Test card'));
  assert.ok(queries.some(q => q.query === 'Consider adding tests for this module'));
});

test('generateQueries deduplicates same query', () => {
  const cards = [makeCard({ id: 'card-a', status: 'accepted', title: 'Same text', suggestion: 'Same text' })];
  const queries = generateQueries(cards);
  // Title and suggestion are the same, so we get 1 unique
  assert.equal(queries.length, 1);
});

test('formatEval handles zero accepted cards', () => {
  const report = {
    repoRoot: '/tmp/test',
    headSha: 'abc123',
    cardsTotal: 5,
    acceptedCards: 0,
    queries: 0,
    strategies: [],
    bestStrategy: 'none',
    timestamp: '2026-01-01T00:00:00Z',
  };
  const output = formatEval(report);
  assert.ok(output.includes('No accepted cards'));
});

test('formatEval includes strategy results', () => {
  const report = {
    repoRoot: '/tmp/test',
    headSha: 'abc123',
    cardsTotal: 5,
    acceptedCards: 3,
    queries: 5,
    strategies: [
      {
        strategy: 'keyword',
        hits: 4,
        total: 5,
        hitRate: 0.8,
        results: [
          { queryId: 'q1', query: 'test', expectedTitle: 'Card', found: true, rank: 1, score: 0.9 },
          { queryId: 'q2', query: 'test2', expectedTitle: 'Card2', found: false, rank: null, score: null },
        ],
      },
      {
        strategy: 'embedding',
        hits: 5,
        total: 5,
        hitRate: 1.0,
        results: [
          { queryId: 'q1', query: 'test', expectedTitle: 'Card', found: true, rank: 1, score: 0.95 },
          { queryId: 'q2', query: 'test2', expectedTitle: 'Card2', found: true, rank: 2, score: 0.8 },
        ],
      },
    ],
    bestStrategy: 'embedding',
    timestamp: '2026-01-01T00:00:00Z',
  };
  const output = formatEval(report);
  assert.ok(output.includes('keyword'));
  assert.ok(output.includes('embedding'));
  assert.ok(output.includes('100.0%'));
  assert.ok(output.includes('80.0%'));
  assert.ok(output.includes('embedding'));
});
