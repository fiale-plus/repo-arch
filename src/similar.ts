import { mineHistory, type GitHistoryRecord } from './git-history.js';
import { classifyHistory, type ClassifiedCommit } from './signals.js';
import { generateCards, type InsightCard } from './cards.js';
import { getStatusOverrideMap } from './review.js';
import { loadIndex, buildIndex, searchIndex, embed, DEFAULT_MODEL } from './embedder.js';
import { resolveRepoRoot, getHeadSha } from './git-history.js';
import { cachedOrGenerate } from './cache.js';

export type SimilarResult = {
  query: string;
  results: { id: string; text: string; source: string; score: number; metadata: Record<string, string> }[];
  indexStats: { model: string; dim: number; entries: number; headSha: string };
};

export async function similar(
  query: string,
  options: { repoPath?: string; topK?: number } = {},
): Promise<SimilarResult> {
  const repoRoot = resolveRepoRoot(options.repoPath);
  const headSha = getHeadSha(repoRoot);
  const topK = options.topK ?? 5;

  // Load or build index
  let index = loadIndex(repoRoot);

  if (!index || index.headSha !== headSha) {
    // Build index from cards
    const generateFn = () => {
      const history = mineHistory({ repoPath: options.repoPath });
      const classified = classifyHistory(history.records);
      return generateCards(classified, {}, getStatusOverrideMap(repoRoot));
    };
    const { cards } = cachedOrGenerate(repoRoot, generateFn);

    const entries = cards.map(card => ({
      id: card.id,
      text: `${card.title}. ${card.suggestion} ${card.supportingCommits.map(c => c.subject).join('. ')}`,
      source: 'card' as const,
      metadata: { type: card.type, confidence: String(card.confidence), status: card.status },
    }));

    index = await buildIndex(entries, { repoPath: options.repoPath });
  }

  // Embed query
  const queryEmbedding = await embed(query);

  // Search
  const results = searchIndex(index, queryEmbedding, topK);

  return {
    query,
    results: results.map(r => ({
      id: r.entry.id,
      text: r.entry.text,
      source: r.entry.source,
      score: parseFloat(r.score.toFixed(4)),
      metadata: r.entry.metadata,
    })),
    indexStats: {
      model: index.model,
      dim: index.dim,
      entries: index.entries.length,
      headSha: index.headSha.slice(0, 12),
    },
  };
}
