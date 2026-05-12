import * as assert from 'node:assert/strict';
import test from 'node:test';
import { classifyHistory, classifyCommit, SIGNAL_DEFS, type ClassifiedCommit } from '../src/signals.js';
import { mineHistory } from '../src/git-history.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as childProcess from 'node:child_process';

function setupRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-arch-test-'));
  childProcess.execFileSync('git', ['init', '-b', 'main'], { cwd: root, encoding: 'utf8' });
  childProcess.execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: root, encoding: 'utf8' });
  childProcess.execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root, encoding: 'utf8' });

  // commit 1: initial (no strong signals)
  fs.writeFileSync(path.join(root, 'index.ts'), '// entry\n');
  childProcess.execFileSync('git', ['add', 'index.ts'], { cwd: root, encoding: 'utf8' });
  childProcess.execFileSync('git', ['commit', '-m', 'initial commit'], { cwd: root, encoding: 'utf8' });

  // commit 2: fix
  fs.writeFileSync(path.join(root, 'index.ts'), '// fixed\n');
  childProcess.execFileSync('git', ['add', 'index.ts'], { cwd: root, encoding: 'utf8' });
  childProcess.execFileSync('git', ['commit', '-m', 'fix crash when parsing empty input'], { cwd: root, encoding: 'utf8' });

  // commit 3: rationale
  fs.writeFileSync(path.join(root, 'auth.ts'), '// auth\n');
  childProcess.execFileSync('git', ['add', 'auth.ts'], { cwd: root, encoding: 'utf8' });
  childProcess.execFileSync('git', ['commit', '-m', 'use Redis because Postgres was too slow'], { cwd: root, encoding: 'utf8' });

  // commit 4: revert
  childProcess.execFileSync('git', ['revert', '--no-edit', 'HEAD'], { cwd: root, encoding: 'utf8' });

  // commit 5: refactor + test file
  fs.writeFileSync(path.join(root, 'lib.ts'), '// lib\n');
  fs.writeFileSync(path.join(root, 'lib.test.ts'), '// test\n');
  childProcess.execFileSync('git', ['add', 'lib.ts', 'lib.test.ts'], { cwd: root, encoding: 'utf8' });
  childProcess.execFileSync('git', ['commit', '-m', 'refactor auth into lib module'], { cwd: root, encoding: 'utf8' });

  return root;
}

test('classifyCommit detects fix signal from subject', () => {
  const record = {
    sha: 'abc',
    parents: [],
    author: { name: 'T', email: 't@t' },
    authoredAt: '2026-01-01',
    subject: 'fix crash in parser',
    files: [{ status: 'M', path: 'parser.ts' }],
    paths: ['parser.ts'],
  };
  const classified = classifyCommit(record);
  const fixSignal = classified.signals.find(s => s.type === 'fix');
  assert.ok(fixSignal, 'should have fix signal');
  assert.equal(fixSignal!.confidence, 1.0);
  assert.equal(fixSignal!.matchedOn, 'subject');
});

test('classifyCommit detects rationale signal', () => {
  const record = {
    sha: 'abc',
    parents: [],
    author: { name: 'T', email: 't@t' },
    authoredAt: '2026-01-01',
    subject: 'use Redis because Postgres was too slow',
    files: [{ status: 'A', path: 'cache.ts' }],
    paths: ['cache.ts'],
  };
  const classified = classifyCommit(record);
  const rationaleSignal = classified.signals.find(s => s.type === 'rationale');
  assert.ok(rationaleSignal, 'should have rationale signal');
});

test('classifyCommit detects revert signal', () => {
  const record = {
    sha: 'abc',
    parents: ['def'],
    author: { name: 'T', email: 't@t' },
    authoredAt: '2026-01-01',
    subject: 'Revert "use Redis because Postgres was too slow"',
    files: [{ status: 'M', path: 'cache.ts' }],
    paths: ['cache.ts'],
  };
  const classified = classifyCommit(record);
  const revertSignal = classified.signals.find(s => s.type === 'revert');
  assert.ok(revertSignal, 'should have revert signal');
  assert.equal(revertSignal!.confidence, 1.0);
});

test('classifyCommit detects test signal from file', () => {
  const record = {
    sha: 'abc',
    parents: [],
    author: { name: 'T', email: 't@t' },
    authoredAt: '2026-01-01',
    subject: 'add user module',
    files: [{ status: 'A', path: 'src/user.test.ts' }, { status: 'A', path: 'src/user.ts' }],
    paths: ['src/user.test.ts', 'src/user.ts'],
  };
  const classified = classifyCommit(record);
  const testSignal = classified.signals.find(s => s.type === 'test');
  assert.ok(testSignal, 'should have test signal from file pattern');
  assert.equal(testSignal!.matchedOn, 'file');
});

test('classifyCommit no signals for neutral subject', () => {
  const record = {
    sha: 'abc',
    parents: [],
    author: { name: 'T', email: 't@t' },
    authoredAt: '2026-01-01',
    subject: 'initial commit',
    files: [{ status: 'A', path: 'src/main.ts' }],
    paths: ['src/main.ts'],
  };
  const classified = classifyCommit(record);
  assert.equal(classified.signals.length, 0, 'initial commit should have no signals');
});

test('classifyHistory works end-to-end on a real repo', () => {
  const repo = setupRepo();
  const history = mineHistory({ repoPath: repo });
  const classified = classifyHistory(history.records);

  assert.equal(classified.length, 5);

  // commit 0: "initial commit" — should have no signals
  assert.equal(classified[0]!.signals.length, 0, 'initial commit no signals');

  // commit 1: "fix crash..." — should have fix signal
  assert.ok(classified[1]!.signals.some(s => s.type === 'fix'), 'fix commit should have fix signal');

  // commit 2: "use Redis because..." — should have rationale
  assert.ok(classified[2]!.signals.some(s => s.type === 'rationale'), 'rationale commit should have rationale signal');

  // commit 3: revert — should have revert signal
  assert.ok(classified[3]!.signals.some(s => s.type === 'revert'), 'revert commit should have revert signal');

  // commit 4: "refactor auth..." — should have refactor signal
  assert.ok(classified[4]!.signals.some(s => s.type === 'refactor'), 'refactor commit should have refactor signal');
  // Also has test file changes so test signal may or may not be there — that's fine
});
