import * as assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as childProcess from 'node:child_process';
import { checkStaleness, formatStaleness } from '../src/staleness.js';
import type { InsightCard } from '../src/cards.js';

function setupRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-arch-test-'));
  childProcess.execFileSync('git', ['init', '-b', 'main'], { cwd: root, encoding: 'utf8' });
  childProcess.execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: root, encoding: 'utf8' });
  childProcess.execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root, encoding: 'utf8' });
  fs.writeFileSync(path.join(root, 'active.ts'), '// active\n');
  fs.writeFileSync(path.join(root, 'deleted.ts'), '// will be deleted\n');
  childProcess.execFileSync('git', ['add', 'active.ts', 'deleted.ts'], { cwd: root, encoding: 'utf8' });
  childProcess.execFileSync('git', ['commit', '-m', 'initial'], { cwd: root, encoding: 'utf8' });
  // Delete deleted.ts
  childProcess.execFileSync('git', ['rm', 'deleted.ts'], { cwd: root, encoding: 'utf8' });
  childProcess.execFileSync('git', ['commit', '-m', 'remove deleted.ts'], { cwd: root, encoding: 'utf8' });
  return root;
}

function makeCard(overrides: Partial<InsightCard>): InsightCard {
  return {
    id: 'test-card-00000001',
    type: 'churn-hotspot',
    title: 'Test card',
    confidence: 0.7,
    status: 'pending',
    supportingCommits: [],
    affectedFiles: [],
    suggestion: 'Test suggestion',
    ...overrides,
  };
}

test('checkStaleness marks fresh card', () => {
  const repo = setupRepo();
  const cards = [makeCard({ affectedFiles: ['active.ts'] })];
  const result = checkStaleness(cards, { repoPath: repo });

  assert.equal(result.total, 1);
  assert.equal(result.fresh, 1);
  assert.equal(result.results[0]?.status, 'fresh');
  assert.equal(result.results[0]?.missingFiles.length, 0);
});

test('checkStaleness marks stale card', () => {
  const repo = setupRepo();
  const cards = [makeCard({ affectedFiles: ['deleted.ts'] })];
  const result = checkStaleness(cards, { repoPath: repo });

  assert.equal(result.stale, 1);
  assert.equal(result.results[0]?.status, 'stale');
  assert.deepEqual(result.results[0]?.missingFiles, ['deleted.ts']);
});

test('checkStaleness marks partial when some files missing', () => {
  const repo = setupRepo();
  const cards = [makeCard({ affectedFiles: ['active.ts', 'deleted.ts'] })];
  const result = checkStaleness(cards, { repoPath: repo });

  assert.equal(result.partial, 1);
  assert.equal(result.results[0]?.status, 'partial');
  assert.deepEqual(result.results[0]?.existingFiles, ['active.ts']);
  assert.deepEqual(result.results[0]?.missingFiles, ['deleted.ts']);
});

test('checkStaleness handles multiple cards', () => {
  const repo = setupRepo();
  const cards = [
    makeCard({ id: 'a', affectedFiles: ['active.ts'] }),
    makeCard({ id: 'b', affectedFiles: ['deleted.ts'] }),
    makeCard({ id: 'c', affectedFiles: ['active.ts', 'deleted.ts'] }),
  ];
  const result = checkStaleness(cards, { repoPath: repo });

  assert.equal(result.total, 3);
  assert.equal(result.fresh, 1);
  assert.equal(result.partial, 1);
  assert.equal(result.stale, 1);
});

test('checkStaleness handles empty cards list', () => {
  const repo = setupRepo();
  const result = checkStaleness([], { repoPath: repo });
  assert.equal(result.total, 0);
  assert.equal(result.fresh, 0);
});

test('formatStaleness produces non-empty output', () => {
  const repo = setupRepo();
  const cards = [makeCard({ affectedFiles: ['deleted.ts'] })];
  const result = checkStaleness(cards, { repoPath: repo });
  const formatted = formatStaleness(result);

  assert.ok(formatted.length > 30);
  assert.ok(formatted.includes('STALE') || formatted.includes('stale'));
});

test('formatStaleness shows all-clear when everything fresh', () => {
  const repo = setupRepo();
  const cards = [makeCard({ affectedFiles: ['active.ts'] })];
  const result = checkStaleness(cards, { repoPath: repo });
  const formatted = formatStaleness(result);

  assert.ok(formatted.includes('All cards'));
});
