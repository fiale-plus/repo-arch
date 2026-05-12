import * as assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as childProcess from 'node:child_process';
import { why, formatWhy } from '../src/why.js';
import type { WhyResult } from '../src/why.js';

function setupRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-arch-test-'));
  childProcess.execFileSync('git', ['init', '-b', 'main'], { cwd: root, encoding: 'utf8' });
  childProcess.execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: root, encoding: 'utf8' });
  childProcess.execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root, encoding: 'utf8' });

  // Create src/ directory
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });

  // commit 1: initial
  fs.writeFileSync(path.join(root, 'src/core.ts'), '// entry\n');
  fs.writeFileSync(path.join(root, 'src/auth.ts'), '// auth\n');
  childProcess.execFileSync('git', ['add', 'src/core.ts', 'src/auth.ts'], { cwd: root, encoding: 'utf8' });
  childProcess.execFileSync('git', ['commit', '-m', 'initial commit'], { cwd: root, encoding: 'utf8' });

  // commit 2: fix + rationale touching core.ts
  fs.writeFileSync(path.join(root, 'src/core.ts'), '// fixed crash\n');
  childProcess.execFileSync('git', ['add', 'src/core.ts'], { cwd: root, encoding: 'utf8' });
  childProcess.execFileSync('git', ['commit', '-m', 'fix crash because of null pointer in parser'], { cwd: root, encoding: 'utf8' });

  // commit 3: fix touching core.ts again
  fs.writeFileSync(path.join(root, 'src/core.ts'), '// fixed again\n');
  childProcess.execFileSync('git', ['add', 'src/core.ts'], { cwd: root, encoding: 'utf8' });
  childProcess.execFileSync('git', ['commit', '-m', 'fix regression in core parser'], { cwd: root, encoding: 'utf8' });

  // commit 4: touches both core.ts and lib.ts (for co-change)
  fs.writeFileSync(path.join(root, 'src/core.ts'), '// updated\n');
  fs.writeFileSync(path.join(root, 'src/lib.ts'), '// lib\n');
  childProcess.execFileSync('git', ['add', 'src/core.ts', 'src/lib.ts'], { cwd: root, encoding: 'utf8' });
  childProcess.execFileSync('git', ['commit', '-m', 'refactor core utils into lib module'], { cwd: root, encoding: 'utf8' });

  return root;
}

test('why returns data for a file with commits', () => {
  const repo = setupRepo();
  const result = why('src/core.ts', { repoPath: repo });

  assert.equal(result.filePath, 'src/core.ts');
  assert.ok(result.commitCount > 0, 'should have commits touching the file');
  assert.ok(result.touchingCommits.length > 0);
  assert.ok(result.repoRoot.startsWith('/'), 'should have repoRoot');
  assert.ok(result.headSha.length > 0, 'should have headSha');
});

test('why detects fix signals on the file', () => {
  const repo = setupRepo();
  const result = why('src/core.ts', { repoPath: repo });

  const fixSignal = result.signalSummary.find(s => s.type === 'fix');
  assert.ok(fixSignal, 'should detect fix signal');
  assert.ok((fixSignal?.count ?? 0) >= 1, 'should have at least 1 fix commit');
  assert.ok(result.fixCommits.length >= 1, 'should list fix commits');
});

test('why detects rationale signals', () => {
  const repo = setupRepo();
  const result = why('src/core.ts', { repoPath: repo });

  const rationaleSignal = result.signalSummary.find(s => s.type === 'rationale');
  assert.ok(rationaleSignal, 'should detect rationale signal ("because" in commit message)');
});

test('why detects co-change partners', () => {
  const repo = setupRepo();
  const result = why('src/core.ts', { repoPath: repo });

  const partner = result.coChangePartners.find(p => p.path === 'src/lib.ts');
  assert.ok(partner, 'should detect src/lib.ts as co-change partner');
  assert.equal(partner!.count, 1, 'should appear once');
});

test('formatWhy produces non-empty output', () => {
  const repo = setupRepo();
  const result = why('src/core.ts', { repoPath: repo });
  const formatted = formatWhy(result);

  assert.ok(formatted.length > 50, 'formatted output should be substantial');
  assert.ok(formatted.includes('src/core.ts'), 'should include file path');
  assert.ok(formatted.includes('commit'), 'should mention commits');
});

test('why for unknown file returns zero commits', () => {
  const repo = setupRepo();
  const result = why('src/ghost.ts', { repoPath: repo });

  assert.equal(result.commitCount, 0);
  assert.equal(result.touchingCommits.length, 0);
  const formatted = formatWhy(result);
  assert.ok(formatted.includes('No commits found'), 'should show fallback message');
});
