import * as assert from 'node:assert/strict';
import test from 'node:test';
import { whyContextPack, diffContextPack, cardsContextPack, cardToContextCard } from '../src/context-pack.js';
import type { DiffWarning } from '../src/check-diff.js';

test('cardsContextPack returns expected shape', () => {
  const pack = cardsContextPack('all cards', [], 'abc123def4567890', true);
  assert.equal(pack.query, 'all cards');
  assert.equal(pack.cards.length, 0);
  assert.equal(pack.warnings.length, 0);
  assert.ok(pack.answerSummary.includes('0 cards'));
});

test('cardsContextPack includes cache warning when fresh', () => {
  const pack = cardsContextPack('all cards', [], 'abc123', false);
  assert.equal(pack.warnings.length, 1);
  assert.ok(pack.warnings[0]!.includes('fresh'));
});

test('whyContextPack returns expected shape', () => {
  const pack = whyContextPack(
    'src/core.ts',
    [],
    5,
    [{ type: 'fix', label: 'Bug fix', count: 2 }],
    ['local git only'],
  );
  assert.equal(pack.query, 'src/core.ts');
  assert.ok(pack.answerSummary.includes('5 commits'));
  assert.ok(pack.answerSummary.includes('2 fix'));
  assert.equal(pack.warnings.length, 1);
});

test('diffContextPack returns warnings in pack', () => {
  const warnings: DiffWarning[] = [
    {
      filePath: 'src/buggy.ts',
      type: 'repeated-fix',
      severity: 'high',
      message: 'file was fixed 3 times',
      evidence: 'commit abc',
      confidence: 0.8,
    },
  ];
  const pack = diffContextPack('main', 'HEAD', ['src/buggy.ts'], warnings);
  assert.equal(pack.query, 'diff main..HEAD');
  assert.equal(pack.warnings.length, 1);
  assert.ok(pack.warnings[0]!.includes('[HIGH]'));
  assert.ok(pack.warnings[0]!.includes('3 times'));
});

test('diffContextPack returns success message for clean diff', () => {
  const pack = diffContextPack('main', 'HEAD', ['src/clean.ts'], []);
  assert.ok(pack.answerSummary.includes('No historical warnings'));
});

test('cardToContextCard preserves card fields', () => {
  const card = {
    id: 'abc123',
    type: 'repeated-fix' as const,
    title: 'Test card',
    confidence: 0.8,
    status: 'accepted' as const,
    supportingCommits: [{ sha: 'def456', subject: 'fix bug' }],
    affectedFiles: ['src/buggy.ts'],
    suggestion: 'Add tests',
  };
  const ctx = cardToContextCard(card);
  assert.equal(ctx.id, 'abc123');
  assert.equal(ctx.type, 'repeated-fix');
  assert.equal(ctx.status, 'accepted');
  assert.equal(ctx.evidence.length, 1);
  assert.equal(ctx.evidence[0]!.sha, 'def456');
});
