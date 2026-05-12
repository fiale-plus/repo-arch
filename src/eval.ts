import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveRepoRoot, getHeadSha } from './git-history.js';
import { mineHistory } from './git-history.js';
import { classifyHistory } from './signals.js';
import { generateCards, type InsightCard } from './cards.js';
import { getStatusOverrideMap } from './review.js';
import { cachedOrGenerate } from './cache.js';
import { loadIndex, buildIndex, searchIndex, embed, cosineSimilarity, DEFAULT_MODEL } from './embedder.js';

export type EvalQuery = {
  id: string;
  query: string;
  expectedCardId: string;
  expectedTitle: string;
};

export type StrategyResult = {
  strategy: string;
  hits: number;
  total: number;
  hitRate: number;
  results: { queryId: string; query: string; expectedTitle: string; found: boolean; rank: number | null; score: number | null }[];
};

export type EvalReport = {
  repoRoot: string;
  headSha: string;
  cardsTotal: number;
  acceptedCards: number;
  queries: number;
  strategies: StrategyResult[];
  bestStrategy: string;
  timestamp: string;
};

export function generateQueries(cards: InsightCard[]): EvalQuery[] {
  const queries: EvalQuery[] = [];
  for (const card of cards) {
    if (card.status !== 'accepted') continue;

    // Query from title
    queries.push({
      id: `${card.id}-title`,
      query: card.title,
      expectedCardId: card.id,
      expectedTitle: card.title,
    });

    // Query from suggestion (truncated to key phrase)
    const short = card.suggestion.replace(/\.(?:\s|$).*/, '').trim();
    if (short && short !== card.title) {
      queries.push({
        id: `${card.id}-suggestion`,
        query: short,
        expectedCardId: card.id,
        expectedTitle: card.title,
      });
    }
  }
  return queries;
}

function keywordSearch(query: string, cards: InsightCard[], topK: number = 5): { card: InsightCard; score: number }[] {
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);

  const scored = cards.map(card => {
    const haystack = `${card.title} ${card.suggestion} ${card.affectedFiles.join(' ')}`.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (haystack.includes(term)) score += 1;
    }
    return { card, score: score / terms.length };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}

export async function runEval(options: { repoPath?: string } = {}): Promise<EvalReport> {
  const repoRoot = resolveRepoRoot(options.repoPath);
  const headSha = getHeadSha(repoRoot);

  // Get cards with review state
  const generateFn = () => {
    const history = mineHistory({ repoPath: options.repoPath });
    const classified = classifyHistory(history.records);
    return generateCards(classified, {}, getStatusOverrideMap(repoRoot));
  };
  const { cards } = cachedOrGenerate(repoRoot, generateFn);

  const acceptedCards = cards.filter(c => c.status === 'accepted');
  const queries = generateQueries(cards);

  if (acceptedCards.length === 0) {
    return {
      repoRoot,
      headSha: headSha.slice(0, 12),
      cardsTotal: cards.length,
      acceptedCards: 0,
      queries: 0,
      strategies: [],
      bestStrategy: 'none',
      timestamp: new Date().toISOString(),
    };
  }

  const strategyResults: StrategyResult[] = [];

  // Strategy 1: Keyword search
  {
    const results: StrategyResult['results'] = [];
    for (const q of queries) {
      const topResults = keywordSearch(q.query, cards, 5);
      const foundIdx = topResults.findIndex(r => r.card.id === q.expectedCardId);
      results.push({
        queryId: q.id,
        query: q.query,
        expectedTitle: q.expectedTitle,
        found: foundIdx >= 0,
        rank: foundIdx >= 0 ? foundIdx + 1 : null,
        score: foundIdx >= 0 ? topResults[foundIdx]!.score : null,
      });
    }
    const hits = results.filter(r => r.found).length;
    strategyResults.push({
      strategy: 'keyword',
      hits,
      total: results.length,
      hitRate: parseFloat((hits / results.length).toFixed(3)),
      results,
    });
  }

  // Strategy 2: Embedding search
  {
    // Build or load embedding index
    let index = loadIndex(repoRoot);
    if (!index || index.headSha !== headSha) {
      const entries = cards.map(card => ({
        id: card.id,
        text: `${card.title}. ${card.suggestion} ${card.supportingCommits.map(c => c.subject).join('. ')}`,
        source: 'card' as const,
        metadata: { type: card.type, confidence: String(card.confidence), status: card.status },
      }));
      index = await buildIndex(entries, { repoPath: options.repoPath });
    }

    const results: StrategyResult['results'] = [];
    for (const q of queries) {
      const queryEmbedding = await embed(q.query);
      const topResults = searchIndex(index, queryEmbedding, 5);
      const foundIdx = topResults.findIndex(r => r.entry.id === q.expectedCardId);
      results.push({
        queryId: q.id,
        query: q.query,
        expectedTitle: q.expectedTitle,
        found: foundIdx >= 0,
        rank: foundIdx >= 0 ? foundIdx + 1 : null,
        score: foundIdx >= 0 ? topResults[foundIdx]!.score : null,
      });
    }
    const hits = results.filter(r => r.found).length;
    strategyResults.push({
      strategy: 'embedding',
      hits,
      total: results.length,
      hitRate: parseFloat((hits / results.length).toFixed(3)),
      results,
    });
  }

  // Determine best strategy
  const sorted = [...strategyResults].sort((a, b) => b.hitRate - a.hitRate);
  const bestStrategy = sorted.length > 0 ? sorted[0]!.strategy : 'none';

  return {
    repoRoot,
    headSha: headSha.slice(0, 12),
    cardsTotal: cards.length,
    acceptedCards: acceptedCards.length,
    queries: queries.length,
    strategies: strategyResults,
    bestStrategy,
    timestamp: new Date().toISOString(),
  };
}

export function formatEval(report: EvalReport): string {
  const lines: string[] = [];

  if (report.acceptedCards === 0) {
    lines.push(`\n  No accepted cards to evaluate.`);
    lines.push(`  Use "repo-arch accept <card-id>" on some cards first.\n`);
    return lines.join('\n');
  }

  lines.push(`\n  Eval benchmark for ${report.repoRoot}`);
  lines.push(`  ${report.headSha} | ${report.cardsTotal} cards (${report.acceptedCards} accepted, ${report.queries} queries)\n`);

  for (const strategy of report.strategies) {
    const rate = (strategy.hitRate * 100).toFixed(1);
    const bar = '█'.repeat(Math.round(strategy.hitRate * 20));
    const empty = '░'.repeat(20 - Math.round(strategy.hitRate * 20));
    lines.push(`  ${strategy.strategy.padEnd(12)} ${bar}${empty} ${rate}% (${strategy.hits}/${strategy.total})`);
  }

  lines.push(`\n  Best strategy: ${report.bestStrategy}\n`);

  // Show misses for worst strategy
  const worst = [...report.strategies].sort((a, b) => a.hitRate - b.hitRate)[0];
  if (worst) {
    const misses = worst.results.filter(r => !r.found).slice(0, 5);
    if (misses.length > 0) {
      lines.push(`  Missed queries (${worst.strategy}):`);
      for (const m of misses) {
        lines.push(`    · "${m.query}" — expected "${m.expectedTitle.slice(0, 60)}"`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}
