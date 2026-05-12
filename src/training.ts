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

  // General "why" question
  if (card.type === 'rationale-cluster' || card.type === 'repeated-fix') {
    examples.push({
      messages: [
        { role: 'user', content: `Why should I be careful when changing ${fileStr}?` },
        { role: 'assistant', content: `${card.title}. ${card.suggestion} Evidence: ${card.supportingCommits.map(c => c.subject).join('; ')}.` },
      ],
      sourceCardId: card.id,
      taskType: 'qa',
    });
  }

  // Direct question from card title
  const titleQuestion = card.title.replace(/^High-churn file:/, 'Why does').replace(/^Repeated fixes in:/, 'What keeps breaking in').replace(/^Possible test gap:/, 'Is there test coverage for').replace(/^Reversion pattern:?/, 'Has this been reverted before');
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
  if (card.type === 'repeated-fix' || card.type === 'revert-pattern') {
    examples.push({
      messages: [
        { role: 'user', content: `Review this change touching ${card.affectedFiles.join(', ')}.\nWhat risks should I check?` },
        { role: 'assistant', content: `Warning: ${card.title}. ${card.suggestion} This area has ${card.supportingCommits.length} relevant commits in history.` },
      ],
      sourceCardId: card.id,
      taskType: 'review-warning',
    });
  }
  return examples;
}

export function generateRiskClassification(card: InsightCard): DatasetExample[] {
  const examples: DatasetExample[] = [];
  const riskLevel = card.confidence >= 0.7 ? 'high' : card.confidence >= 0.5 ? 'medium' : 'low';

  examples.push({
    messages: [
      { role: 'user', content: `Classify risk for changing ${card.affectedFiles.join(', ')}.` },
      { role: 'assistant', content: JSON.stringify({
        risk: card.type === 'revert-pattern' ? 'revert_instability' : card.type === 'repeated-fix' ? 'regression_risk' : card.type === 'test-gap' ? 'test_coverage_concern' : 'informational',
        severity: riskLevel,
        confidence: card.confidence,
        reason: card.suggestion,
      }) },
    ],
    sourceCardId: card.id,
    taskType: 'risk-classification',
  });

  return examples;
}

function generateNegative(cards: InsightCard[]): DatasetExample[] {
  // Generate negative examples from low-confidence or churn-hotspot cards
  const negatives: DatasetExample[] = [];
  for (const card of cards) {
    if (card.type === 'churn-hotspot' && card.confidence < 0.6) {
      negatives.push({
        messages: [
          { role: 'user', content: `Review this change touching ${card.affectedFiles.join(', ')}.\nWhat risks should I check?` },
          { role: 'assistant', content: `No specific historical warnings for this file. It changes frequently but has no repeated fix or revert patterns. Standard review applies.` },
        ],
        sourceCardId: card.id,
        taskType: 'negative',
      });
    }
  }

  // Add a generic negative if few exist
  if (negatives.length === 0) {
    negatives.push({
      messages: [
        { role: 'user', content: 'Review this change touching src/new-feature.ts.\nWhat risks should I check?' },
        { role: 'assistant', content: 'No historical warnings found for this file. Standard review applies.' },
      ],
      sourceCardId: 'generic',
      taskType: 'negative',
    });
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

  // Show a sample
  const first = result.examples[0];
  if (first) {
    lines.push(`  Sample (${first.taskType}):`);
    lines.push(`    User: ${first.messages[0]!.content.slice(0, 80)}...`);
    lines.push(`    Assistant: ${first.messages[1]!.content.slice(0, 80)}...`);
    lines.push('');
  }

  return lines.join('\n');
}
