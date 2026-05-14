import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mineHistory, type MineHistoryResult } from './git-history.js';
import { classifyHistory } from './signals.js';
import { generateCards, type InsightCard } from './cards.js';
import { getStatusOverrideMap, listReviewState } from './review.js';
import { buildIndex } from './embedder.js';
import { generateDataset, prepareTrain, type DatasetResult, type TrainPlan } from './training.js';
import { runEval, type EvalReport } from './eval.js';
import { loadRepoArchConfig, type ResolvedRepoArchConfig } from './config.js';

export type FlowRunOptions = {
  repoPath?: string;
  configPath?: string;
  outPath?: string;
  full?: boolean;
  includeRejected?: boolean;
  minConfidence?: number;
  maxCards?: number;
  model?: string;
  iters?: number;
  learningRate?: number;
};

export type FlowStageStatus = 'ok' | 'skipped' | 'failed';

export type FlowStageResult = {
  name: string;
  status: FlowStageStatus;
  startedAt: string;
  finishedAt: string;
  artifact?: string;
  details?: Record<string, string | number | boolean | null>;
  error?: string;
};

export type FlowManifest = {
  schemaVersion: 1;
  tool: {
    name: 'repo-arch';
    version: string;
  };
  run: {
    id: string;
    repoRoot: string;
    headSha: string;
    configPath: string | null;
    configHash: string;
    startedAt: string;
    finishedAt?: string;
    full: boolean;
  };
  config: {
    runsDir: string;
    cards: ResolvedRepoArchConfig['cards'];
    index: ResolvedRepoArchConfig['index'];
    training: ResolvedRepoArchConfig['training'];
  };
  stages: FlowStageResult[];
  artifacts: Record<string, string>;
  summary: {
    commits: number;
    cards: number;
    acceptedCards: number;
    pendingCards: number;
    rejectedCards: number;
    examples: number;
    keywordHitRate?: number;
    embeddingHitRate?: number;
    bestStrategy?: string;
    valLoss?: number;
  };
};

export type FlowRunResult = {
  runDir: string;
  manifestPath: string;
  manifest: FlowManifest;
  config: ResolvedRepoArchConfig;
  history: MineHistoryResult;
  cards: InsightCard[];
  dataset: DatasetResult;
  trainPlan: TrainPlan;
  evalReport?: EvalReport;
};

export type FlowInspectResult = {
  runDir: string;
  manifestPath: string;
  manifest: FlowManifest;
};

function getToolVersion(): string {
  const packageJsonPath = fileURLToPath(new URL('../package.json', import.meta.url));
  const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { version?: string };
  return parsed.version ?? 'unknown';
}

function hashJson(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function now(): string {
  return new Date().toISOString();
}

function ensureDirFor(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function ensureDir(filePath: string): void {
  fs.mkdirSync(filePath, { recursive: true });
}

function writeJson(filePath: string, data: unknown): void {
  ensureDirFor(filePath);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function writeJsonl(filePath: string, lines: unknown[]): void {
  ensureDirFor(filePath);
  const jsonl = lines.map(line => JSON.stringify(line)).join('\n') + (lines.length ? '\n' : '');
  fs.writeFileSync(filePath, jsonl, 'utf8');
}

function countCardStatuses(cards: InsightCard[]): { accepted: number; pending: number; rejected: number } {
  let accepted = 0;
  let pending = 0;
  let rejected = 0;
  for (const card of cards) {
    if (card.status === 'accepted') accepted += 1;
    else if (card.status === 'rejected') rejected += 1;
    else pending += 1;
  }
  return { accepted, pending, rejected };
}

function createRunId(headSha: string): string {
  return `${now().replace(/[:.]/g, '-')}-${headSha.slice(0, 12)}`;
}

function resolveRunDir(config: ResolvedRepoArchConfig, options: { outPath?: string; runId?: string } = {}): string {
  if (options.outPath) {
    return path.isAbsolute(options.outPath) ? options.outPath : path.resolve(config.repoRoot, options.outPath);
  }
  return path.join(config.flow.runsDir, options.runId ?? createRunId(''));
}

function writeLatestPointer(runsDir: string, runId: string, runDir: string): void {
  const latestPath = path.join(runsDir, 'latest.json');
  ensureDir(runsDir);
  writeJson(latestPath, {
    schemaVersion: 1,
    runId,
    runDir,
    updatedAt: now(),
  });
}

function resolveLatestRunDir(runsDir: string): string | null {
  const latestPath = path.join(runsDir, 'latest.json');
  if (fs.existsSync(latestPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(latestPath, 'utf8')) as { runDir?: string };
      if (parsed.runDir && fs.existsSync(parsed.runDir)) return parsed.runDir;
    } catch {
      // fall through
    }
  }

  if (!fs.existsSync(runsDir)) return null;
  const entries = fs
    .readdirSync(runsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== 'latest')
    .map(entry => path.join(runsDir, entry.name))
    .filter(entry => fs.existsSync(path.join(entry, 'manifest.json')))
    .sort();

  return entries.length > 0 ? entries[entries.length - 1]! : null;
}

function formatPercent(value?: number): string {
  if (typeof value !== 'number') return 'n/a';
  return `${(value * 100).toFixed(1)}%`;
}

export function buildFlowManifest(params: {
  config: ResolvedRepoArchConfig;
  runId: string;
  startedAt: string;
  finishedAt?: string;
  full: boolean;
  stages: FlowStageResult[];
  cards: InsightCard[];
  dataset: DatasetResult;
  trainPlan: TrainPlan;
  evalReport?: EvalReport;
  history: MineHistoryResult;
  runDir: string;
}): FlowManifest {
  const statusCounts = countCardStatuses(params.cards);
  const evalKeyword = params.evalReport?.strategies.find(strategy => strategy.strategy === 'keyword')?.hitRate;
  const evalEmbedding = params.evalReport?.strategies.find(strategy => strategy.strategy === 'embedding')?.hitRate;
  const bestStrategy = params.evalReport?.bestStrategy;

  return {
    schemaVersion: 1,
    tool: {
      name: 'repo-arch',
      version: getToolVersion(),
    },
    run: {
      id: params.runId,
      repoRoot: params.config.repoRoot,
      headSha: params.history.headSha,
      configPath: params.config.configPath,
      configHash: hashJson(params.config.raw),
      startedAt: params.startedAt,
      finishedAt: params.finishedAt,
      full: params.full,
    },
    config: {
      runsDir: params.config.flow.runsDir,
      cards: params.config.cards,
      index: params.config.index,
      training: params.config.training,
    },
    stages: params.stages,
    artifacts: {
      history: 'history.jsonl',
      classified: 'classified.jsonl',
      cards: 'cards.jsonl',
      dataset: 'dataset.jsonl',
      trainingDir: path.relative(params.runDir, path.join(params.runDir, 'training')),
      trainPlan: 'training/train-plan.json',
      manifest: 'manifest.json',
      latest: path.relative(params.runDir, path.join(path.dirname(params.runDir), 'latest.json')),
      ...(params.evalReport ? { eval: 'eval.json' } : {}),
      ...(params.evalReport ? { index: 'index.json' } : {}),
    },
    summary: {
      commits: params.history.count,
      cards: params.cards.length,
      acceptedCards: statusCounts.accepted,
      pendingCards: statusCounts.pending,
      rejectedCards: statusCounts.rejected,
      examples: params.dataset.examples.length,
      keywordHitRate: evalKeyword,
      embeddingHitRate: evalEmbedding,
      bestStrategy,
      valLoss: undefined,
    },
  };
}

function makeStage(name: string, status: FlowStageStatus, startedAt: string, extras: Partial<FlowStageResult> = {}): FlowStageResult {
  return {
    name,
    status,
    startedAt,
    finishedAt: now(),
    ...extras,
  };
}

export async function runFlow(options: FlowRunOptions = {}): Promise<FlowRunResult> {
  const config = loadRepoArchConfig({ repoPath: options.repoPath, configPath: options.configPath });
  const history = mineHistory({ repoPath: config.repoRoot });
  const runId = createRunId(history.headSha);
  const runDir = resolveRunDir(config, { outPath: options.outPath, runId });
  const startedAt = now();
  const stages: FlowStageResult[] = [];
  const artifacts: Record<string, string> = {};

  ensureDir(runDir);
  ensureDir(path.join(runDir, 'training'));

  let classified: ReturnType<typeof classifyHistory> = [];
  let cards: InsightCard[] = [];
  let dataset: DatasetResult | undefined;
  let trainPlan: TrainPlan | undefined;
  let evalReport: EvalReport | undefined;

  const full = options.full ?? false;
  const includeRejected = options.includeRejected ?? config.training.includeRejected;
  const cardMinConfidence = options.minConfidence ?? config.cards.minConfidence;
  const cardMaxCards = options.maxCards ?? config.cards.maxCards;
  const trainingModel = options.model ?? config.training.model;
  const trainingIters = options.iters ?? config.training.iters;
  const trainingLearningRate = options.learningRate ?? config.training.learningRate;

  try {
    const historyOut = path.join(runDir, 'history.jsonl');
    fs.writeFileSync(historyOut, history.jsonl, 'utf8');
    stages.push(makeStage('history', 'ok', startedAt, {
      artifact: 'history.jsonl',
      details: { commits: history.count, cacheHit: history.cacheHit },
    }));
    artifacts.history = 'history.jsonl';

    const classifyStartedAt = now();
    classified = classifyHistory(history.records);
    const classifiedOut = path.join(runDir, 'classified.jsonl');
    writeJsonl(classifiedOut, classified);
    stages.push(makeStage('classify', 'ok', classifyStartedAt, {
      artifact: 'classified.jsonl',
      details: { commits: classified.length },
    }));
    artifacts.classified = 'classified.jsonl';

    const cardsStartedAt = now();
    cards = generateCards(classified, {
      minConfidence: cardMinConfidence,
      maxCards: cardMaxCards,
    }, getStatusOverrideMap(config.repoRoot));
    const cardsOut = path.join(runDir, 'cards.jsonl');
    writeJsonl(cardsOut, cards);
    const statusCounts = countCardStatuses(cards);
    stages.push(makeStage('cards', 'ok', cardsStartedAt, {
      artifact: 'cards.jsonl',
      details: {
        cards: cards.length,
        accepted: statusCounts.accepted,
        pending: statusCounts.pending,
        rejected: statusCounts.rejected,
      },
    }));
    artifacts.cards = 'cards.jsonl';
    writeJson(path.join(runDir, 'review.json'), {
      schemaVersion: 1,
      cards: statusCounts,
      reviewState: listReviewState(config.repoRoot),
    });
    artifacts.review = 'review.json';

    const datasetStartedAt = now();
    dataset = generateDataset({ repoPath: config.repoRoot, includeRejected });
    const datasetOut = path.join(runDir, 'dataset.jsonl');
    fs.writeFileSync(datasetOut, dataset.examples.map(example => JSON.stringify(example)).join('\n') + (dataset.examples.length ? '\n' : ''), 'utf8');
    writeJson(path.join(runDir, 'dataset.json'), {
      schemaVersion: 1,
      repoRoot: dataset.repoRoot,
      headSha: dataset.headSha,
      totalCards: dataset.totalCards,
      acceptedCards: dataset.acceptedCards,
      counts: dataset.counts,
      examples: dataset.examples.length,
    });
    stages.push(makeStage('dataset', 'ok', datasetStartedAt, {
      artifact: 'dataset.jsonl',
      details: {
        examples: dataset.examples.length,
        qa: dataset.counts.qa,
        reviewWarning: dataset.counts['review-warning'],
        riskClassification: dataset.counts['risk-classification'],
        negative: dataset.counts.negative,
      },
    }));
    artifacts.dataset = 'dataset.jsonl';

    const trainPlanStartedAt = now();
    trainPlan = prepareTrain({
      repoPath: config.repoRoot,
      outPath: path.join(runDir, 'training'),
      model: trainingModel,
      iters: trainingIters,
      learningRate: trainingLearningRate,
      adapterName: `repo-arch-${history.headSha.slice(0, 7)}`,
    });
    writeJson(path.join(runDir, 'training', 'train-plan.json'), {
      schemaVersion: 1,
      ...trainPlan,
      note: 'Use repo-arch train cycle to continue training or train run for a one-shot run.',
    });
    stages.push(makeStage('train-plan', 'ok', trainPlanStartedAt, {
      artifact: path.join('training', 'train-plan.json'),
      details: {
        examples: trainPlan.examples,
        model: trainPlan.model,
      },
    }));
    artifacts.trainPlan = path.join('training', 'train-plan.json');
    artifacts.trainingDir = 'training';

    if (full) {
      const indexStartedAt = now();
      if (cards.length > 0) {
        const entries = cards.map(card => ({
          id: card.id,
          text: `${card.title}. ${card.suggestion} ${card.supportingCommits.map(commit => commit.subject).join('. ')}`,
          source: 'card' as const,
          metadata: {
            type: card.type,
            confidence: String(card.confidence),
            status: card.status,
          },
        }));
        const index = await buildIndex(entries, { repoPath: config.repoRoot, model: config.index.model });
        writeJson(path.join(runDir, 'index.json'), {
          schemaVersion: 1,
          model: index.model,
          dim: index.dim,
          headSha: index.headSha,
          entries: index.entries.length,
          createdAt: index.createdAt,
        });
        stages.push(makeStage('index', 'ok', indexStartedAt, {
          artifact: 'index.json',
          details: {
            entries: index.entries.length,
            model: index.model,
          },
        }));
        artifacts.index = 'index.json';
      } else {
        stages.push(makeStage('index', 'skipped', indexStartedAt, {
          details: { reason: 'no cards to index' },
        }));
      }

      const evalStartedAt = now();
      evalReport = await runEval({ repoPath: config.repoRoot });
      writeJson(path.join(runDir, 'eval.json'), evalReport);
      const keyword = evalReport.strategies.find(strategy => strategy.strategy === 'keyword')?.hitRate;
      const embedding = evalReport.strategies.find(strategy => strategy.strategy === 'embedding')?.hitRate;
      stages.push(makeStage('eval', 'ok', evalStartedAt, {
        artifact: 'eval.json',
        details: {
          queries: evalReport.queries,
          keyword: typeof keyword === 'number' ? keyword : null,
          embedding: typeof embedding === 'number' ? embedding : null,
          bestStrategy: evalReport.bestStrategy,
        },
      }));
      artifacts.eval = 'eval.json';
    } else {
      const indexStartedAt = now();
      stages.push(makeStage('index', 'skipped', indexStartedAt, {
        details: { reason: 'use repo-arch flow run full to build embeddings' },
      }));
      const evalStartedAt = now();
      stages.push(makeStage('eval', 'skipped', evalStartedAt, {
        details: { reason: 'use repo-arch flow run full to run evaluation' },
      }));
    }

    const finishedAt = now();
    const manifest = buildFlowManifest({
      config,
      runId,
      startedAt,
      finishedAt,
      full,
      stages,
      cards,
      dataset: dataset!,
      trainPlan: trainPlan!,
      evalReport,
      history,
      runDir,
    });

    writeJson(path.join(runDir, 'manifest.json'), manifest);
    writeLatestPointer(config.flow.runsDir, runId, runDir);

    return {
      runDir,
      manifestPath: path.join(runDir, 'manifest.json'),
      manifest,
      config,
      history,
      cards,
      dataset: dataset!,
      trainPlan: trainPlan!,
      evalReport,
    };
  } catch (error) {
    const finishedAt = now();
    const failedManifest = buildFlowManifest({
      config,
      runId,
      startedAt,
      finishedAt,
      full,
      stages,
      cards,
      dataset: dataset ?? {
        repoRoot: config.repoRoot,
        headSha: history.headSha.slice(0, 12),
        totalCards: cards.length,
        acceptedCards: countCardStatuses(cards).accepted,
        examples: [],
        counts: { qa: 0, 'review-warning': 0, 'risk-classification': 0, negative: 0 },
      },
      trainPlan: trainPlan ?? {
        dataDir: path.join(runDir, 'training'),
        trainFile: path.join(runDir, 'training', 'train.jsonl'),
        validFile: path.join(runDir, 'training', 'valid.jsonl'),
        model: config.training.model,
        iters: config.training.iters,
        learningRate: config.training.learningRate,
        adapterPath: path.join(config.repoRoot, '.repo-arch', 'adapters', `repo-arch-${history.headSha.slice(0, 7)}`),
        command: '',
        examples: 0,
      },
      evalReport,
      history,
      runDir,
    });
    writeJson(path.join(runDir, 'manifest.json'), failedManifest);
    writeLatestPointer(config.flow.runsDir, runId, runDir);
    throw error;
  }
}

export function inspectFlow(options: { repoPath?: string; configPath?: string; runId?: string } = {}): FlowInspectResult {
  const config = loadRepoArchConfig({ repoPath: options.repoPath, configPath: options.configPath });
  const runDir = resolveRunDirForInspect(config, options.runId);
  if (!runDir) {
    throw new Error('No repo-arch run found. Use repo-arch flow run first.');
  }
  const manifestPath = path.join(runDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing manifest: ${manifestPath}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as FlowManifest;
  return { runDir, manifestPath, manifest };
}

function resolveRunDirForInspect(config: ResolvedRepoArchConfig, runId?: string): string | null {
  if (!runId || runId === 'latest') {
    return resolveLatestRunDir(config.flow.runsDir);
  }
  if (path.isAbsolute(runId) || runId.includes(path.sep)) {
    if (!fs.existsSync(runId)) return null;
    const stat = fs.statSync(runId);
    return stat.isDirectory() ? runId : path.dirname(runId);
  }
  const candidate = path.join(config.flow.runsDir, runId);
  return fs.existsSync(candidate) ? candidate : null;
}

export function formatFlowRun(result: FlowRunResult): string {
  const { manifest } = result;
  const cards = manifest.summary.cards;
  const accepted = manifest.summary.acceptedCards;
  const pending = manifest.summary.pendingCards;
  const rejected = manifest.summary.rejectedCards;
  const lines: string[] = [];
  lines.push(`\n  Repo-Arch flow run for ${manifest.run.repoRoot}`);
  lines.push(`  ${manifest.run.id} | ${manifest.run.headSha.slice(0, 12)} | ${manifest.run.full ? 'full' : 'prepare'}\n`);
  lines.push(`  Config: ${manifest.run.configPath ?? '(defaults)'}`);
  lines.push(`  Run dir: ${result.runDir}\n`);
  lines.push(`  history      ${manifest.summary.commits} commits`);
  lines.push(`  cards        ${cards} cards (${accepted} accepted, ${pending} pending, ${rejected} rejected)`);
  lines.push(`  dataset      ${manifest.summary.examples} examples`);
  lines.push(`  train-plan   ${result.trainPlan.examples} examples -> ${result.trainPlan.trainFile}`);

  if (manifest.summary.keywordHitRate !== undefined || manifest.summary.embeddingHitRate !== undefined) {
    lines.push(`  eval         keyword ${formatPercent(manifest.summary.keywordHitRate)} | embedding ${formatPercent(manifest.summary.embeddingHitRate)}`);
  }

  lines.push(`\n  Next:`);
  lines.push(`  repo-arch flow inspect`);
  lines.push(`  repo-arch review list`);
  lines.push(`  repo-arch train cycle`);
  lines.push('');
  return lines.join('\n');
}

export function formatFlowInspect(result: FlowInspectResult): string {
  const { manifest } = result;
  const lines: string[] = [];
  lines.push(`\n  Repo-Arch run: ${manifest.run.id}`);
  lines.push(`  Repo: ${manifest.run.repoRoot}`);
  lines.push(`  Head: ${manifest.run.headSha}`);
  lines.push(`  Config: ${manifest.run.configPath ?? '(defaults)'}`);
  lines.push(`  Status: ${manifest.stages.some(stage => stage.status === 'failed') ? 'failed' : 'ok'}\n`);

  for (const stage of manifest.stages) {
    const status = stage.status === 'ok' ? '✓' : stage.status === 'skipped' ? '→' : '✗';
    const artifact = stage.artifact ? ` → ${stage.artifact}` : '';
    const details = stage.details ? ` (${Object.entries(stage.details).map(([k, v]) => `${k}=${v}`).join(', ')})` : '';
    lines.push(`  ${status} ${stage.name}${artifact}${details}`);
  }

  lines.push(`\n  Summary:`);
  lines.push(`  commits: ${manifest.summary.commits}`);
  lines.push(`  cards: ${manifest.summary.cards} (accepted ${manifest.summary.acceptedCards}, pending ${manifest.summary.pendingCards}, rejected ${manifest.summary.rejectedCards})`);
  lines.push(`  examples: ${manifest.summary.examples}`);
  if (manifest.summary.keywordHitRate !== undefined || manifest.summary.embeddingHitRate !== undefined) {
    lines.push(`  eval: keyword ${formatPercent(manifest.summary.keywordHitRate)} | embedding ${formatPercent(manifest.summary.embeddingHitRate)}`);
  }
  if (manifest.summary.bestStrategy) {
    lines.push(`  bestStrategy: ${manifest.summary.bestStrategy}`);
  }
  if (manifest.summary.valLoss !== undefined) {
    lines.push(`  valLoss: ${manifest.summary.valLoss}`);
  }

  lines.push(`\n  Next:`);
  if (manifest.stages.find(stage => stage.name === 'index' && stage.status === 'skipped')) {
    lines.push('  repo-arch flow run full');
  }
  lines.push('  repo-arch train cycle');
  lines.push('  repo-arch review list');
  lines.push('');
  return lines.join('\n');
}
