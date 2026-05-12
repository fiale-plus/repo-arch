import * as assert from 'node:assert/strict';
import test from 'node:test';
import { generateCards, CARD_GENERATORS } from '../src/cards.js';
import type { ClassifiedCommit } from '../src/signals.js';

function mockCommit(overrides: Partial<ClassifiedCommit>): ClassifiedCommit {
  return {
    sha: 'abc123',
    parents: [],
    author: { name: 'T', email: 't@t' },
    authoredAt: '2026-01-01',
    subject: 'some change',
    files: [],
    paths: [],
    signals: [],
    ...overrides,
  };
}

test('churn-hotspot: top files by change count', () => {
  const records: ClassifiedCommit[] = [];
  for (let i = 0; i < 5; i++) {
    records.push(mockCommit({
      sha: `fix${i}`,
      subject: `fix iteration ${i}`,
      files: [{ status: 'M', path: 'src/hot.ts' }],
      paths: ['src/hot.ts'],
    }));
  }
  records.push(mockCommit({
    files: [{ status: 'M', path: 'src/cold.ts' }],
    paths: ['src/cold.ts'],
  }));
  const cards = generateCards(records);
  const churns = cards.filter(c => c.type === 'churn-hotspot');
  assert.ok(churns.length > 0, 'should generate churn cards');
  assert.ok(churns.some(c => c.affectedFiles.includes('src/hot.ts')), 'hot.ts should be flagged');
});

test('repeated-fix: files fixed >=2 times', () => {
  const records: ClassifiedCommit[] = [];
  for (let i = 0; i < 3; i++) {
    records.push(mockCommit({
      sha: `fix${i}`,
      subject: `fix bug ${i}`,
      files: [{ status: 'M', path: 'src/buggy.ts' }],
      paths: ['src/buggy.ts'],
      signals: [{ type: 'fix', label: 'Bug fix', confidence: 1.0, matchedOn: 'subject' }],
    }));
  }
  const cards = generateCards(records);
  const fixCards = cards.filter(c => c.type === 'repeated-fix');
  assert.ok(fixCards.length > 0, 'should generate fix cards');
  assert.ok(fixCards.some(c => c.affectedFiles.includes('src/buggy.ts')), 'buggy.ts should be flagged');
});

test('repeated-fix: single fix commit does not trigger card', () => {
  const records: ClassifiedCommit[] = [
    mockCommit({
      subject: 'fix something',
      files: [{ status: 'M', path: 'src/once.ts' }],
      paths: ['src/once.ts'],
      signals: [{ type: 'fix', label: 'Bug fix', confidence: 1.0, matchedOn: 'subject' }],
    }),
  ];
  const cards = generateCards(records);
  assert.equal(cards.filter(c => c.type === 'repeated-fix').length, 0, 'single fix should not trigger');
});

test('rationale-cluster: groups rationale commits by directory', () => {
  const records: ClassifiedCommit[] = [
    mockCommit({
      subject: 'use Redis because Postgres was too slow',
      files: [{ status: 'A', path: 'cache/redis.ts' }],
      paths: ['cache/redis.ts'],
      signals: [{ type: 'rationale', label: 'Contains rationale', confidence: 0.7, matchedOn: 'subject' }],
    }),
    mockCommit({
      subject: 'cache invalidation strategy since we serve stale data',
      files: [{ status: 'M', path: 'cache/invalidate.ts' }],
      paths: ['cache/invalidate.ts'],
      signals: [{ type: 'rationale', label: 'Contains rationale', confidence: 0.7, matchedOn: 'subject' }],
    }),
  ];
  const cards = generateCards(records);
  const rationaleCards = cards.filter(c => c.type === 'rationale-cluster');
  assert.ok(rationaleCards.length > 0, 'should generate rationale cards');
});

test('revert-pattern: detects revert commits', () => {
  const records: ClassifiedCommit[] = [
    mockCommit({
      subject: 'add feature',
      files: [{ status: 'A', path: 'src/feature.ts' }],
      paths: ['src/feature.ts'],
    }),
    mockCommit({
      subject: 'Revert "add feature"',
      files: [{ status: 'D', path: 'src/feature.ts' }],
      paths: ['src/feature.ts'],
      signals: [{ type: 'revert', label: 'Revert', confidence: 1.0, matchedOn: 'subject' }],
    }),
  ];
  const cards = generateCards(records);
  const revertCards = cards.filter(c => c.type === 'revert-pattern');
  assert.ok(revertCards.length > 0, 'should generate revert cards');
});

test('test-gap: flags source changes without test changes', () => {
  const records: ClassifiedCommit[] = Array.from({ length: 10 }, (_, i) =>
    mockCommit({
      sha: `n${i}`,
      subject: `change ${i}`,
      files: [{ status: 'M', path: 'src/core.ts' }],
      paths: ['src/core.ts'],
    }),
  );
  const cards = generateCards(records);
  const testGapCards = cards.filter(c => c.type === 'test-gap');
  assert.ok(testGapCards.length > 0, 'should flag test gaps');
  assert.ok(testGapCards.some(c => c.affectedFiles.includes('src/core.ts')), 'core.ts should be flagged');
});

test('co-change: detects files that change together', () => {
  const records: ClassifiedCommit[] = Array.from({ length: 3 }, (_, i) =>
    mockCommit({
      sha: `c${i}`,
      subject: `change ${i}`,
      files: [
        { status: 'M', path: 'src/a.ts' },
        { status: 'M', path: 'src/b.ts' },
      ],
      paths: ['src/a.ts', 'src/b.ts'],
    }),
  );
  const cards = generateCards(records);
  const coCards = cards.filter(c => c.type === 'co-change');
  assert.ok(coCards.length > 0, 'should generate co-change cards');
});

test('cards are sorted by confidence descending', () => {
  const records: ClassifiedCommit[] = Array.from({ length: 6 }, (_, i) =>
    mockCommit({
      sha: `fix${i}`,
      subject: `fix bug ${i}`,
      files: [{ status: 'M', path: `src/buggy${i % 2}.ts` }],
      paths: [`src/buggy${i % 2}.ts`],
      signals: [{ type: 'fix', label: 'Bug fix', confidence: 1.0, matchedOn: 'subject' }],
    }),
  );
  const cards = generateCards(records);
  for (let i = 1; i < cards.length; i++) {
    assert.ok(cards[i]!.confidence <= cards[i - 1]!.confidence,
      `cards[${i}].confidence (${cards[i]!.confidence}) should be <= cards[${i - 1}].confidence (${cards[i - 1]!.confidence})`);
  }
});

test('CARD_GENERATORS registry has expected card types', () => {
  const types = CARD_GENERATORS.map(g => g.type);
  assert.ok(types.includes('churn-hotspot'));
  assert.ok(types.includes('repeated-fix'));
  assert.ok(types.includes('rationale-cluster'));
  assert.ok(types.includes('test-gap'));
  assert.ok(types.includes('revert-pattern'));
  assert.ok(types.includes('co-change'));
  assert.equal(types.length, 6);
});

test('minConfidence filter works', () => {
  const records: ClassifiedCommit[] = Array.from({ length: 10 }, (_, i) =>
    mockCommit({
      sha: `n${i}`,
      subject: `change ${i}`,
      files: [{ status: 'M', path: 'src/core.ts' }],
      paths: ['src/core.ts'],
    }),
  );
  const all = generateCards(records, { minConfidence: 0 });
  const filtered = generateCards(records, { minConfidence: 0.9 });
  assert.ok(filtered.length <= all.length, 'higher minConfidence should produce fewer or equal cards');
});

test('maxCards limit works', () => {
  const records: ClassifiedCommit[] = Array.from({ length: 20 }, (_, i) =>
    mockCommit({
      sha: `n${i}`,
      subject: `change ${i}`,
      files: [{ status: 'M', path: `src/file${i % 3}.ts` }],
      paths: [`src/file${i % 3}.ts`],
    }),
  );
  const limited = generateCards(records, { maxCards: 3 });
  assert.ok(limited.length <= 3, 'maxCards should cap output');
});
