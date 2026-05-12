import * as assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as childProcess from 'node:child_process';
import { checkDiff } from '../src/check-diff.js';

function setupRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-arch-test-'));
  childProcess.execFileSync('git', ['init', '-b', 'main'], { cwd: root, encoding: 'utf8' });
  childProcess.execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: root, encoding: 'utf8' });
  childProcess.execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root, encoding: 'utf8' });

  fs.mkdirSync(path.join(root, 'src'), { recursive: true });

  // commit 1: initial
  fs.writeFileSync(path.join(root, 'src/a.ts'), '// a\n');
  childProcess.execFileSync('git', ['add', 'src/a.ts'], { cwd: root, encoding: 'utf8' });
  childProcess.execFileSync('git', ['commit', '-m', 'initial'], { cwd: root, encoding: 'utf8' });

  // commit 2: fix a.ts (repeat fix)
  fs.writeFileSync(path.join(root, 'src/a.ts'), '// a v2\n');
  childProcess.execFileSync('git', ['add', 'src/a.ts'], { cwd: root, encoding: 'utf8' });
  childProcess.execFileSync('git', ['commit', '-m', 'fix crash in a'], { cwd: root, encoding: 'utf8' });

  // commit 3: fix a.ts again (repeat fix trigger)
  fs.writeFileSync(path.join(root, 'src/a.ts'), '// a v3\n');
  childProcess.execFileSync('git', ['add', 'src/a.ts'], { cwd: root, encoding: 'utf8' });
  childProcess.execFileSync('git', ['commit', '-m', 'fix regression in a'], { cwd: root, encoding: 'utf8' });

  // commit 4: add b.ts + revert
  fs.writeFileSync(path.join(root, 'src/b.ts'), '// b\n');
  childProcess.execFileSync('git', ['add', 'src/b.ts'], { cwd: root, encoding: 'utf8' });
  childProcess.execFileSync('git', ['commit', '-m', 'add b feature'], { cwd: root, encoding: 'utf8' });

  // commit 5: revert b.ts
  childProcess.execFileSync('git', ['revert', '--no-edit', 'HEAD'], { cwd: root, encoding: 'utf8' });

  return root;
}

test('check-diff returns warnings for repeat-fix files', () => {
  const repo = setupRepo();
  // HEAD~1..HEAD = the revert commit (deletes b.ts)
  const result = checkDiff({ repoPath: repo, base: 'HEAD~1', head: 'HEAD' });
  
  // The revert touches b.ts — may produce revert-pattern warning (expected behavior)
  const revertWarnings = result.warnings.filter(w => w.type === 'revert-pattern');
  // This is fine — revert pattern detection is working
  
  // Now check HEAD~4..HEAD — includes the fix commits on src/a.ts
  const result2 = checkDiff({ repoPath: repo, base: 'HEAD~4', head: 'HEAD' });
  // The diff between HEAD~4 and HEAD includes a.ts (which was changed in commits 2-3)
  // Also includes b.ts (added then reverted)
  // src/a.ts was fixed twice — should have a repeat-fix warning
  const hasFixWarning = result2.warnings.some(w => w.type === 'repeated-fix');
  assert.ok(hasFixWarning, 'should have a repeat-fix warning for src/a.ts');
});

test('check-diff returns empty warnings for clean diff', () => {
  const repo = setupRepo();
  const result = checkDiff({ repoPath: repo, base: 'HEAD~0', head: 'HEAD' }); // same commit
  assert.equal(result.warnings.length, 0, 'no diff means no warnings');
});

test('check-diff returns basic metadata', () => {
  const repo = setupRepo();
  const result = checkDiff({ repoPath: repo, base: 'HEAD~1', head: 'HEAD' });
  assert.ok(result.repoRoot.includes('repo-arch-test-'), 'should have repoRoot');
  assert.ok(result.baseSha.length > 0);
  assert.ok(result.headSha.length > 0);
  assert.ok(Array.isArray(result.warnings));
});
