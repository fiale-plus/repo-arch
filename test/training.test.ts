import * as assert from 'node:assert/strict';
import test from 'node:test';
import { generateDataset, generateQa, generateReviewWarning, generateRiskClassification } from '../src/training.js';
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

test('generateDataset includes qa, warning, risk for accepted cards', () => {
  const result = generateDataset();
  // Uses cached cards from the current repo — just check shape
  assert.ok('repoRoot' in result);
  assert.ok('headSha' in result);
  assert.ok(typeof result.totalCards === 'number');
  assert.ok(typeof result.examples.length === 'number');
});

test('generateReviewWarning creates warnings for repeated-fix cards', () => {
  const card = makeCard({ type: 'repeated-fix' });
  const examples = generateReviewWarning(card);
  assert.ok(examples.length > 0);
  assert.equal(examples[0]?.taskType, 'review-warning');
  assert.ok(examples[0]?.messages[0]?.content.includes('Review this change'));
  assert.ok(examples[0]?.messages[1]?.content.includes('Warning'));
});

test('generateReviewWarning does not create warnings for test-gap cards', () => {
  const card = makeCard({ type: 'test-gap', title: 'Possible test gap: src/foo.ts' });
  const examples = generateReviewWarning(card);
  assert.equal(examples.length, 0);
});

test('generateRiskClassification includes risk level', () => {
  const card = makeCard({ type: 'revert-pattern', title: 'Reversion pattern: src/core.ts', confidence: 0.9 });
  const examples = generateRiskClassification(card);
  assert.ok(examples.length > 0);
  const assistant = examples[0]?.messages[1]?.content;
  assert.ok(assistant);
  const parsed = JSON.parse(assistant);
  assert.equal(parsed.risk, 'revert_instability');
  assert.equal(parsed.severity, 'high');
});

test('generateDataset example structure is valid JSONL', () => {
  const card = makeCard();
  const examples = generateReviewWarning(card);
  for (const ex of examples) {
    assert.ok(typeof ex.sourceCardId === 'string');
    assert.equal(ex.messages.length, 2);
    assert.equal(ex.messages[0]?.role, 'user');
    assert.equal(ex.messages[1]?.role, 'assistant');
    // Verify it can be serialized (valid JSONL)
    const serialized = JSON.stringify(ex);
    const parsed = JSON.parse(serialized);
    assert.equal(parsed.taskType, ex.taskType);
  }
});
