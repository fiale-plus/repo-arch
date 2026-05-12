const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { execFileSync } = require('node:child_process');
const { mineHistory } = require('../src/git-history');

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function setupRepo() {
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
  assert.equal(result.records[0].subject, 'initial add');
  assert.deepEqual(result.records[0].files, [{ status: 'A', path: 'a.txt' }]);
  assert.equal(result.records[1].subject, 'update files');
  assert.deepEqual(result.records[1].paths.sort(), ['a.txt', 'b.txt']);
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
  const cli = path.resolve(__dirname, '../src/cli.js');
  execFileSync('node', [cli, 'mine-history', '--repo', repo, '--out', out], { encoding: 'utf8' });

  const lines = fs.readFileSync(out, 'utf8').trim().split(/\r?\n/);
  assert.equal(lines.length, 2);
  const parsed = lines.map(line => JSON.parse(line));
  assert.equal(parsed[0].sha.length > 0, true);
});
