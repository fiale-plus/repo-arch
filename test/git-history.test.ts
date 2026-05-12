import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mineHistory } from '../src/git-history.js';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function setupRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-arch-test-'));
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.name', 'Test User']);
  git(root, ['config', 'user.email', 'test@example.com']);

  fs.writeFileSync(path.join(root, 'a.txt'), 'one\n');
  git(root, ['add', 'a.txt']);
  git(root, ['commit', '-m', 'initial add']);

  fs.writeFileSync(path.join(root, 'a.txt'), 'two\n');
  fs.writeFileSync(path.join(root, 'b.txt'), 'b\n');
  git(root, ['add', 'a.txt', 'b.txt']);
  git(root, ['commit', '-m', 'update files']);

  return root;
}

test('mineHistory extracts commit metadata and files', () => {
  const repo = setupRepo();
  const result = mineHistory({ repoPath: repo });

  assert.equal(result.count, 2);
  assert.equal(result.cacheHit, false);
  assert.equal(result.records[0]?.subject, 'initial add');
  assert.deepEqual(result.records[0]?.files, [{ status: 'A', path: 'a.txt' }]);
  assert.equal(result.records[1]?.subject, 'update files');
  assert.deepEqual(result.records[1]?.paths.sort(), ['a.txt', 'b.txt']);
  assert.equal(fs.existsSync(result.cacheFile), true);
});

test('mineHistory reuses cached JSONL for unchanged HEAD', () => {
  const repo = setupRepo();
  const first = mineHistory({ repoPath: repo });
  const second = mineHistory({ repoPath: repo });

  assert.equal(first.cacheHit, false);
  assert.equal(second.cacheHit, true);
  assert.equal(second.jsonl, first.jsonl);
});

test('CLI writes JSONL to file', () => {
  const repo = setupRepo();
  const out = path.join(repo, 'history.jsonl');
  const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
  execFileSync('node', ['--import', 'tsx', cli, 'mine-history', '--repo', repo, '--out', out], { encoding: 'utf8' });

  const lines = fs.readFileSync(out, 'utf8').trim().split(/\r?\n/);
  assert.equal(lines.length, 2);
  const parsed = lines.map(line => JSON.parse(line) as { sha: string });
  assert.equal(parsed[0]?.sha.length > 0, true);
});
