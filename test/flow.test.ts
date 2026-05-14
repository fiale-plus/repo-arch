import * as assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as childProcess from 'node:child_process';
import { loadRepoArchConfig, writeRepoArchConfigTemplate } from '../src/config.js';
import { formatFlowInspect, formatFlowRun, inspectFlow, runFlow } from '../src/flow.js';

function setupRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-arch-flow-'));
  childProcess.execFileSync('git', ['init', '-b', 'main'], { cwd: root, encoding: 'utf8' });
  childProcess.execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: root, encoding: 'utf8' });
  childProcess.execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root, encoding: 'utf8' });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });

  for (let i = 0; i < 8; i++) {
    const file = path.join(root, 'src', 'core.ts');
    fs.writeFileSync(file, `// version ${i}\nexport const value = ${i};\n`);
    childProcess.execFileSync('git', ['add', 'src/core.ts'], { cwd: root, encoding: 'utf8' });
    const message = i < 3 ? `fix: core issue ${i}` : i < 5 ? `chore: update core ${i}` : `docs: explain core ${i}`;
    childProcess.execFileSync('git', ['commit', '-m', message], { cwd: root, encoding: 'utf8' });
  }

  return root;
}

test('loadRepoArchConfig resolves defaults and custom config', () => {
  const repo = setupRepo();
  const repoRoot = fs.realpathSync(repo);
  const configPath = path.join(repo, 'repo-arch.config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    schemaVersion: 1,
    flow: { runsDir: '.repo-arch/custom-runs' },
    cards: { minConfidence: 0.5, maxCards: 12 },
    training: { run: true, includeRejected: true },
  }, null, 2));

  const config = loadRepoArchConfig({ repoPath: repo, configPath });
  assert.equal(config.repoRoot, repoRoot);
  assert.ok(config.flow.runsDir.endsWith(path.join('.repo-arch', 'custom-runs')));
  assert.equal(config.cards.minConfidence, 0.5);
  assert.equal(config.cards.maxCards, 12);
  assert.equal(config.training.run, true);
  assert.equal(config.training.includeRejected, true);
});

test('writeRepoArchConfigTemplate creates a starter config', () => {
  const repo = setupRepo();
  const outPath = path.join(repo, 'repo-arch.config.json');
  const config = writeRepoArchConfigTemplate(outPath);
  assert.ok(fs.existsSync(outPath));
  assert.equal(config.schemaVersion, 1);
  const parsed = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.equal(parsed.flow.runsDir, '.repo-arch/runs');
});

test('runFlow writes a run bundle and inspectFlow can read it back', async () => {
  const repo = setupRepo();
  const repoRoot = fs.realpathSync(repo);
  const runDir = path.join(repoRoot, '.repo-arch', 'runs', 'test-run');

  const result = await runFlow({ repoPath: repo, outPath: runDir });
  assert.equal(result.runDir, runDir);
  assert.ok(fs.existsSync(path.join(runDir, 'manifest.json')));
  assert.ok(fs.existsSync(path.join(runDir, 'history.jsonl')));
  assert.ok(fs.existsSync(path.join(runDir, 'cards.jsonl')));
  assert.ok(fs.existsSync(path.join(runDir, 'dataset.jsonl')));
  assert.ok(fs.existsSync(path.join(runDir, 'training', 'train-plan.json')));

  const manifest = result.manifest;
  assert.equal(manifest.schemaVersion, 1);
  assert.ok(manifest.summary.commits > 0);
  assert.ok(manifest.summary.cards > 0);
  assert.ok(manifest.stages.some(stage => stage.name === 'history' && stage.status === 'ok'));
  assert.ok(manifest.stages.some(stage => stage.name === 'train-plan' && stage.status === 'ok'));
  assert.ok(manifest.stages.some(stage => stage.name === 'index' && stage.status === 'skipped'));
  assert.ok(manifest.stages.some(stage => stage.name === 'eval' && stage.status === 'skipped'));

  const inspect = inspectFlow({ repoPath: repo, runId: 'latest' });
  assert.equal(inspect.manifest.run.id, manifest.run.id);
  assert.equal(inspect.manifest.summary.commits, manifest.summary.commits);

  const text = formatFlowRun(result);
  assert.ok(text.includes('Repo-Arch flow run'));
  assert.ok(text.includes('train-plan'));

  const inspectText = formatFlowInspect(inspect);
  assert.ok(inspectText.includes('Repo-Arch run'));
  assert.ok(inspectText.includes('history'));
});
