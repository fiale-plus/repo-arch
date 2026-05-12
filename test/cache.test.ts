import * as assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as childProcess from 'node:child_process';
import { getCachedCards, writeCachedCards, invalidateCache, cachedOrGenerate, CACHE_VERSION } from '../src/cache.js';
import type { InsightCard } from '../src/cards.js';

function setupRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-arch-test-'));
  childProcess.execFileSync('git', ['init', '-b', 'main'], { cwd: root, encoding: 'utf8' });
  childProcess.execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: root, encoding: 'utf8' });
  childProcess.execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root, encoding: 'utf8' });
  fs.writeFileSync(path.join(root, 'f.txt'), 'hello\n');
  childProcess.execFileSync('git', ['add', 'f.txt'], { cwd: root, encoding: 'utf8' });
  childProcess.execFileSync('git', ['commit', '-m', 'initial'], { cwd: root, encoding: 'utf8' });
  return root;
}

function mockCards(): InsightCard[] {
  return [{
    type: 'churn-hotspot',
    title: 'Test card',
    confidence: 0.8,
    supportingCommits: [{ sha: 'abc123', subject: 'test' }],
    affectedFiles: ['f.txt'],
    suggestion: 'Test suggestion',
  }];
}

test('writeCachedCards creates cache file', () => {
  const repo = setupRepo();
  const head = childProcess.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  writeCachedCards(repo, head, mockCards());

  const cacheFile = path.join(repo, '.repo-arch', 'cache', 'cards', `${head}.json`);
  assert.equal(fs.existsSync(cacheFile), true);
  const content = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  assert.equal(content.version, CACHE_VERSION);
  assert.equal(content.headSha, head);
  assert.equal(content.cards.length, 1);
});

test('getCachedCards returns null for missing cache', () => {
  const repo = setupRepo();
  const result = getCachedCards(repo, 'nonexistent');
  assert.equal(result, null);
});

test('getCachedCards returns cached data when valid', () => {
  const repo = setupRepo();
  const head = childProcess.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  writeCachedCards(repo, head, mockCards());

  const result = getCachedCards(repo, head);
  assert.ok(result !== null);
  assert.equal(result!.cards.length, 1);
  assert.equal(result!.headSha, head);
});

test('invalidateCache removes all cache files', () => {
  const repo = setupRepo();
  const head = childProcess.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  writeCachedCards(repo, head, mockCards());
  writeCachedCards(repo, 'deadbeef', mockCards()); // another head

  const removed = invalidateCache(repo);
  assert.equal(removed, 2, 'should remove both cache files');
  assert.equal(fs.existsSync(path.join(repo, '.repo-arch', 'cache', 'cards')), true, 'dir should still exist');
});

test('cachedOrGenerate returns cached data on second call', () => {
  const repo = setupRepo();
  const head = childProcess.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();

  let callCount = 0;
  const generate = () => { callCount++; return mockCards(); };

  const first = cachedOrGenerate(repo, generate);
  assert.equal(first.cacheHit, false);
  assert.equal(first.cards.length, 1);
  assert.equal(first.headSha, head);
  assert.equal(callCount, 1, 'generator should be called once');

  const second = cachedOrGenerate(repo, generate);
  assert.equal(second.cacheHit, true);
  assert.equal(second.cards.length, 1);
  assert.equal(second.headSha, head);
  assert.equal(callCount, 1, 'generator should NOT be called again (cache hit)');
});
