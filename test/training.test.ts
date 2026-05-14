import * as assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as childProcess from 'node:child_process';
import { prepareTrain, formatTrain, generateDataset, findLatestAdapterCheckpoint } from '../src/training.js';
import { formatTrainStatus, formatTrainList } from '../src/train-cycle.js';

function setupRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-arch-test-'));
  childProcess.execFileSync('git', ['init', '-b', 'main'], { cwd: root, encoding: 'utf8' });
  childProcess.execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: root, encoding: 'utf8' });
  childProcess.execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root, encoding: 'utf8' });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });

  // Create enough commits to generate cards
  for (let i = 0; i < 10; i++) {
    fs.writeFileSync(path.join(root, `src/file${i}.ts`), `// file ${i}\n`);
    childProcess.execFileSync('git', ['add', `src/file${i}.ts`], { cwd: root, encoding: 'utf8' });
    childProcess.execFileSync('git', ['commit', '-m', i === 0 ? 'initial commit' : i < 3 ? `fix bug in file${i}` : `update file${i}`], { cwd: root, encoding: 'utf8' });
  }

  return root;
}

function setupRepoWithAcceptedCards(): string {
  const repo = setupRepo();

  // Generate dataset to create cards, then accept them
  const dataset = generateDataset({ repoPath: repo });
  // The cards are pending, so train won't find accepted ones
  // Accept cards manually via review state
  const reviewDir = path.join(repo, '.repo-arch');
  fs.mkdirSync(path.join(reviewDir, 'cards'), { recursive: true });

  // Mine history to get cards
  const { cards } = (() => {
    const { cachedOrGenerate } = require('../src/cache.js');
    const { mineHistory } = require('../src/git-history.js');
    const { classifyHistory } = require('../src/signals.js');
    const { generateCards } = require('../src/cards.js');
    const { getStatusOverrideMap } = require('../src/review.js');
    const history = mineHistory({ repoPath: repo });
    const classified = classifyHistory(history.records);
    const cards = generateCards(classified, {}, getStatusOverrideMap(repo));
    return { cards };
  })();

  // Accept all cards
  const { setCardStatus } = require('../src/review.js');
  for (const card of cards) {
    setCardStatus(repo, card.id, 'accepted');
  }

  return repo;
}

test('prepareTrain generates train/valid split', () => {
  const repo = setupRepo();
  const outDir = path.join(repo, 'train-data');
  const plan = prepareTrain({ repoPath: repo, outPath: outDir });

  assert.equal(plan.dataDir, outDir);
  assert.ok(fs.existsSync(plan.trainFile), 'train.jsonl should exist');
  assert.ok(fs.existsSync(plan.validFile), 'valid.jsonl should exist');
});

test('prepareTrain produces valid mlx command', () => {
  const repo = setupRepo();
  const plan = prepareTrain({ repoPath: repo, outPath: path.join(repo, 'train-data') });

  assert.ok(plan.command.includes('mlx_lm.lora'), 'should reference mlx_lm.lora');
  assert.ok(plan.command.includes('--train'), 'should include --train flag');
  assert.ok(plan.command.includes('--model'), 'should include model');
  assert.ok(plan.command.includes('--data'), 'should include data dir');
  assert.ok(plan.command.includes('--adapter-path'), 'should include adapter path');
});

test('prepareTrain defaults model and iters', () => {
  const repo = setupRepo();
  const plan = prepareTrain({ repoPath: repo, outPath: path.join(repo, 'train-data') });

  assert.ok(plan.model.includes('Qwen'));
  assert.ok(plan.examples > 0);
  assert.ok(plan.adapterPath.includes('.repo-arch/adapters/'));
});

test('formatTrain includes command', () => {
  const plan = {
    dataDir: '/tmp/data',
    trainFile: '/tmp/data/train.jsonl',
    validFile: '/tmp/data/valid.jsonl',
    model: 'test-model',
    iters: 42,
    learningRate: 1e-5,
    adapterPath: '/tmp/adapter',
    command: 'mlx_lm.lora --train --model test-model',
    examples: 10,
  };
  const output = formatTrain(plan);
  assert.ok(output.includes('test-model'));
  assert.ok(output.includes('mlx_lm.lora'));
  assert.ok(output.includes('10 examples'));
});

test('findLatestAdapterCheckpoint picks highest numbered checkpoint', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-arch-checkpoint-'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '0000100_adapters.safetensors'), 'a');
  fs.writeFileSync(path.join(dir, '0000200_adapters.safetensors'), 'b');
  fs.writeFileSync(path.join(dir, 'adapters.safetensors'), 'final');

  const latest = findLatestAdapterCheckpoint(dir);
  assert.equal(latest, path.join(dir, '0000200_adapters.safetensors'));
});

test('formatTrainStatus and formatTrainList render persistent training state', () => {
  const session = {
    schemaVersion: 1 as const,
    sessionId: 'run-123-qwen',
    runId: 'run-123',
    runDir: '/tmp/run-123',
    flowManifestPath: '/tmp/run-123/manifest.json',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:01:00.000Z',
    status: 'ok' as const,
    model: 'test-model',
    iters: 42,
    learningRate: 1e-5,
    adapterPath: '/tmp/run-123/adapters',
    resumeAdapterFile: '/tmp/run-123/adapters/0000100_adapters.safetensors',
    latestCheckpoint: '/tmp/run-123/adapters/0000200_adapters.safetensors',
    command: 'mlx_lm.lora --train',
    trainPlan: '/tmp/run-123/training/train-plan.json',
  };
  const status = formatTrainStatus(session);
  const list = formatTrainList([session]);
  assert.ok(status.includes('run-123-qwen'));
  assert.ok(status.includes('Latest checkpoint'));
  assert.ok(list.includes('run-123-qwen'));
});
