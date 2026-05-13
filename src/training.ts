import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveRepoRoot, getHeadSha } from './git-history.js';
import { mineHistory } from './git-history.js';
import { classifyHistory } from './signals.js';
import { generateCards, type InsightCard, type CardType } from './cards.js';
import { getStatusOverrideMap } from './review.js';
import { cachedOrGenerate } from './cache.js';

export type DatasetExample = {
  messages: { role: 'user' | 'assistant'; content: string }[];
  sourceCardId: string;
  taskType: 'qa' | 'review-warning' | 'risk-classification' | 'negative';
};

export type DatasetOptions = {
  repoPath?: string;
  outPath?: string;
  includeRejected?: boolean;
};

export type DatasetResult = {
  repoRoot: string;
  headSha: string;
  totalCards: number;
  acceptedCards: number;
  examples: DatasetExample[];
  counts: { qa: number; 'review-warning': number; 'risk-classification': number; negative: number };
};

export function generateQa(card: InsightCard): DatasetExample[] {
  const examples: DatasetExample[] = [];
  const fileStr = card.affectedFiles.join(', ');
  const evidence = card.supportingCommits.map(c => c.subject).join('; ');

  if (card.type === 'rationale-cluster' || card.type === 'repeated-fix') {
    examples.push({
      messages: [
        { role: 'user', content: `Why should I be careful when changing ${fileStr}?` },
        { role: 'assistant', content: `${card.title}. ${card.suggestion} Evidence: ${evidence}.` },
      ],
      sourceCardId: card.id,
      taskType: 'qa',
    });
    examples.push({
      messages: [
        { role: 'user', content: `What should I know before modifying ${fileStr}?` },
        { role: 'assistant', content: `${card.title}. ${card.suggestion}` },
      ],
      sourceCardId: card.id,
      taskType: 'qa',
    });
    examples.push({
      messages: [
        { role: 'user', content: `What keeps breaking in ${fileStr}?` },
        { role: 'assistant', content: `${card.title}. ${card.suggestion}` },
      ],
      sourceCardId: card.id,
      taskType: 'qa',
    });
  }

  if (card.type === 'test-gap') {
    examples.push({
      messages: [
        { role: 'user', content: `Is there test coverage for ${fileStr}?` },
        { role: 'assistant', content: `${card.title}. ${card.suggestion}` },
      ],
      sourceCardId: card.id,
      taskType: 'qa',
    });
    examples.push({
      messages: [
        { role: 'user', content: `What should I know before modifying ${fileStr}?` },
        { role: 'assistant', content: `${card.title}. ${card.suggestion}` },
      ],
      sourceCardId: card.id,
      taskType: 'qa',
    });
  }

  const titleQuestion = card.title
    .replace(/^High-churn file:/, 'Why does')
    .replace(/^Repeated fixes in:/, 'What keeps breaking in')
    .replace(/^Possible test gap:/, 'Is there test coverage for')
    .replace(/^Reversion pattern:?/, 'Has this been reverted before');

  if (titleQuestion !== card.title) {
    examples.push({
      messages: [
        { role: 'user', content: `${titleQuestion} ${fileStr}?` },
        { role: 'assistant', content: `${card.title}. ${card.suggestion}` },
      ],
      sourceCardId: card.id,
      taskType: 'qa',
    });
  }

  return examples;
}

export function generateReviewWarning(card: InsightCard): DatasetExample[] {
  const examples: DatasetExample[] = [];
  const fileStr = card.affectedFiles.join(', ');
  if (card.type === 'repeated-fix' || card.type === 'revert-pattern') {
    examples.push({
      messages: [
        { role: 'user', content: `Review this change touching ${fileStr}.\nWhat risks should I check?` },
        { role: 'assistant', content: `Warning: ${card.title}. ${card.suggestion} This area has ${card.supportingCommits.length} relevant commits in history.` },
      ],
      sourceCardId: card.id,
      taskType: 'review-warning',
    });
    examples.push({
      messages: [
        { role: 'user', content: `What should I know before modifying ${fileStr}?` },
        { role: 'assistant', content: `Warning: ${card.title}. ${card.suggestion}` },
      ],
      sourceCardId: card.id,
      taskType: 'review-warning',
    });
  }
  return examples;
}

export function generateRiskClassification(card: InsightCard): DatasetExample[] {
  const examples: DatasetExample[] = [];
  const fileStr = card.affectedFiles.join(', ');
  const riskLevel = card.confidence >= 0.7 ? 'high' : card.confidence >= 0.5 ? 'medium' : 'low';
  const risk = card.type === 'revert-pattern' ? 'revert_instability' : card.type === 'repeated-fix' ? 'regression_risk' : card.type === 'test-gap' ? 'test_coverage_concern' : 'informational';

  const payload = JSON.stringify({
    risk,
    severity: riskLevel,
    confidence: card.confidence,
    reason: card.suggestion,
  });

  examples.push({
    messages: [
      { role: 'user', content: `Classify risk for changing ${fileStr}.` },
      { role: 'assistant', content: payload },
    ],
    sourceCardId: card.id,
    taskType: 'risk-classification',
  });

  if (card.type === 'repeated-fix' || card.type === 'test-gap' || card.type === 'revert-pattern') {
    examples.push({
      messages: [
        { role: 'user', content: `Would it be risky to edit ${fileStr}?` },
        { role: 'assistant', content: payload },
      ],
      sourceCardId: card.id,
      taskType: 'risk-classification',
    });
    examples.push({
      messages: [
        { role: 'user', content: `Could a change to ${fileStr} be risky, and why?` },
        { role: 'assistant', content: payload },
      ],
      sourceCardId: card.id,
      taskType: 'risk-classification',
    });
  }

  return examples;
}

function generateNegative(cards: InsightCard[]): DatasetExample[] {
  const negatives: DatasetExample[] = [];
  const unknownFiles = [
    'src/new-feature.ts',
    'src/unknown-file.ts',
    'packages/unknown/pkg.ts',
    'packages/missing/module.ts',
  ];
  const prompts = [
    (file: string) => `Review this change touching ${file}.\nWhat risks should I check?`,
    (file: string) => `Is there test coverage for ${file}?`,
    (file: string) => `What should I know before modifying ${file}?`,
    (file: string) => `What keeps breaking in ${file}?`,
    (file: string) => `Can you review ${file} and tell me the risk?`,
  ];
  const answer = 'No historical warnings found. Standard review applies.';
  const hardFiles = new Set(['src/new-feature.ts', 'packages/unknown/pkg.ts']);
  const extraPrompts = [
    (file: string) => `Review this change touching ${file}.\nWhat risks should I check?`,
    (file: string) => `Is there test coverage for ${file}?`,
    (file: string) => `What should I know before modifying ${file}?`,
  ];

  for (const file of unknownFiles) {
    for (const makePrompt of prompts) {
      negatives.push({
        messages: [
          { role: 'user', content: makePrompt(file) },
          { role: 'assistant', content: answer },
        ],
        sourceCardId: `negative:${file}`,
        taskType: 'negative',
      });
    }

    if (hardFiles.has(file)) {
      for (let i = 0; i < 2; i += 1) {
        for (const makePrompt of extraPrompts) {
          negatives.push({
            messages: [
              { role: 'user', content: makePrompt(file) },
              { role: 'assistant', content: answer },
            ],
            sourceCardId: `negative:${file}:hard:${i}`,
            taskType: 'negative',
          });
        }
      }
    }

    if (file === 'packages/unknown/pkg.ts') {
      for (let i = 0; i < 4; i += 1) {
        negatives.push({
          messages: [
            { role: 'user', content: `Is there test coverage for ${file}?` },
            { role: 'assistant', content: answer },
          ],
          sourceCardId: `negative:${file}:coverage:${i}`,
          taskType: 'negative',
        });
      }
    }
  }

  for (const card of cards) {
    if (card.type === 'churn-hotspot' && card.confidence < 0.6) {
      negatives.push({
        messages: [
          { role: 'user', content: `Review this change touching ${card.affectedFiles.join(', ')}.\nWhat risks should I check?` },
          { role: 'assistant', content: 'No specific historical warnings for this file. It changes frequently but has no repeated fix or revert patterns. Standard review applies.' },
        ],
        sourceCardId: card.id,
        taskType: 'negative',
      });
      break;
    }
  }

  return negatives;
}

export function generateDataset(options: DatasetOptions = {}): DatasetResult {
  const repoRoot = resolveRepoRoot(options.repoPath);
  const headSha = getHeadSha(repoRoot);

  const generateFn = () => {
    const history = mineHistory({ repoPath: options.repoPath });
    const classified = classifyHistory(history.records);
    return generateCards(classified, {}, getStatusOverrideMap(repoRoot));
  };
  const { cards } = cachedOrGenerate(repoRoot, generateFn);

  const acceptedCards = options.includeRejected
    ? cards.filter(c => c.status === 'accepted' || c.status === 'pending')
    : cards.filter(c => c.status === 'accepted');

  const examples: DatasetExample[] = [];

  for (const card of acceptedCards) {
    examples.push(...generateQa(card));
    examples.push(...generateReviewWarning(card));
    examples.push(...generateRiskClassification(card));
  }

  examples.push(...generateNegative(cards));

  const counts = { qa: 0, 'review-warning': 0, 'risk-classification': 0, negative: 0 };
  for (const ex of examples) {
    counts[ex.taskType]++;
  }

  const result: DatasetResult = {
    repoRoot,
    headSha: headSha.slice(0, 12),
    totalCards: cards.length,
    acceptedCards: acceptedCards.length,
    examples,
    counts,
  };

  if (options.outPath) {
    const jsonl = examples.map(ex => JSON.stringify(ex)).join('\n') + '\n';
    fs.mkdirSync(path.dirname(path.resolve(options.outPath)), { recursive: true });
    fs.writeFileSync(options.outPath, jsonl, 'utf8');
  }

  return result;
}

export function formatDataset(result: DatasetResult): string {
  const lines: string[] = [];
  lines.push(`\n  Training dataset for ${result.repoRoot}`);
  lines.push(`  ${result.headSha} | ${result.totalCards} cards (${result.acceptedCards} training-relevant)`);
  lines.push(`  ${result.examples.length} total examples\n`);

  for (const [type, count] of Object.entries(result.counts)) {
    if (count > 0) {
      lines.push(`  ${type.padEnd(22)} ${count}`);
    }
  }
  lines.push('');

  const first = result.examples[0];
  if (first) {
    lines.push(`  Sample (${first.taskType}):`);
    lines.push(`    User: ${first.messages[0]!.content.slice(0, 80)}...`);
    lines.push(`    Assistant: ${first.messages[1]!.content.slice(0, 80)}...`);
    lines.push('');
  }

  return lines.join('\n');
}

export type TrainOptions = {
  repoPath?: string;
  outPath?: string;
  model?: string;
  iters?: number;
  adapterName?: string;
  learningRate?: number;
  /** Whether to actually run training (vs just printing the command) */
  run?: boolean;
};

export type TrainPlan = {
  dataDir: string;
  trainFile: string;
  validFile: string;
  model: string;
  adapterPath: string;
  command: string;
  examples: number;
};

export function prepareTrain(options: TrainOptions = {}): TrainPlan {
  const repoRoot = resolveRepoRoot(options.repoPath);
  const headSha = getHeadSha(repoRoot);

  const outDir = options.outPath
    ? path.resolve(options.outPath)
    : path.join(repoRoot, '.repo-arch', 'training-data');

  const dataset = generateDataset({ repoPath: options.repoPath });
  const examples = dataset.examples;

  if (examples.length === 0) {
    throw new Error('No training examples generated. Use repo-arch accept on some cards first.');
  }

  const shuffled = [...examples].sort(() => Math.random() - 0.5);
  const minValid = Math.max(4, Math.ceil(shuffled.length * 0.1));
  const splitIdx = Math.max(shuffled.length - minValid, 1);
  const train = shuffled.slice(0, splitIdx);
  const valid = shuffled.slice(splitIdx);

  fs.mkdirSync(outDir, { recursive: true });

  const trainFile = path.join(outDir, 'train.jsonl');
  const validFile = path.join(outDir, 'valid.jsonl');

  fs.writeFileSync(trainFile, train.map(ex => JSON.stringify({ messages: ex.messages })).join('\n') + '\n');
  fs.writeFileSync(validFile, valid.map(ex => JSON.stringify({ messages: ex.messages })).join('\n') + '\n');

  const model = options.model ?? 'Qwen/Qwen2.5-Coder-1.5B-Instruct';
  const adapterName = options.adapterName ?? `repo-arch-${headSha.slice(0, 7)}`;
  const adapterPath = path.join(repoRoot, '.repo-arch', 'adapters', adapterName);
  const iters = options.iters ?? 100;
  const learningRate = options.learningRate ?? 1e-5;

  const command = [
    'mlx_lm.lora',
    '--train',
    `--model ${model}`,
    `--data ${outDir}`,
    `--adapter-path ${adapterPath}`,
    `--num-layers 4`,
    `--batch-size 4`,
    `--iters ${iters}`,
    `--val-batches 10`,
    `--learning-rate ${learningRate}`,
    `--steps-per-report 10`,
    `--steps-per-eval 10`,
  ].join(' \\\n  ');

  return {
    dataDir: outDir,
    trainFile,
    validFile,
    model,
    adapterPath,
    command,
    examples: examples.length,
  };
}

export function formatTrain(plan: TrainPlan): string {
  const lines: string[] = [];
  lines.push(`\n  Training data prepared at ${plan.dataDir}`);
  lines.push(`  ${plan.examples} examples (train + valid)`);
  lines.push(`  Model: ${plan.model}`);
  lines.push(`  Adapter: ${plan.adapterPath}\n`);
  lines.push(`  To train, run:\n`);
  lines.push(`  ${plan.command.replace(/\\n/g, '\n')}`);
  lines.push('');
  return lines.join('\n');
}
