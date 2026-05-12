import type { InsightCard, CardStatus } from './cards.js';
import type { DiffWarning } from './check-diff.js';

/** A protocol-neutral response that any agent harness can consume */
export type ContextPack = {
  /** What was asked — file path, diff range, or natural-language query */
  query: string;
  /** Human-readable summary of the answer */
  answerSummary: string;
  /** Relevant cards, sorted by relevance/confidence */
  cards: ContextPackCard[];
  /** Non-blocking caveats, limitations, or warnings about this response */
  warnings: string[];
};

export type ContextPackCard = {
  id: string;
  type: string;
  status: CardStatus;
  confidence: number;
  title: string;
  supportingCommits: { sha: string; subject: string }[];
  affectedFiles: string[];
  suggestion: string;
  evidence: { type: string; id?: string; title?: string; sha?: string }[];
};

export function cardToContextCard(card: InsightCard): ContextPackCard {
  return {
    id: card.id,
    type: card.type,
    status: card.status,
    confidence: card.confidence,
    title: card.title,
    supportingCommits: card.supportingCommits,
    affectedFiles: card.affectedFiles,
    suggestion: card.suggestion,
    evidence: card.supportingCommits.map(c => ({
      type: 'commit',
      sha: c.sha,
      title: c.subject,
    })),
  };
}

export function whyContextPack(
  filePath: string,
  cards: InsightCard[],
  commitCount: number,
  signalSummary: { type: string; label: string; count: number }[],
  warnings: string[],
): ContextPack {
  const parts: string[] = [`${commitCount} commit${commitCount !== 1 ? 's' : ''}`];
  for (const sig of signalSummary) {
    parts.push(`${sig.count} ${sig.type}`);
  }

  return {
    query: filePath,
    answerSummary: parts.join(' · '),
    cards: cards.map(cardToContextCard),
    warnings,
  };
}

export function diffContextPack(
  baseRef: string,
  headRef: string,
  changedFiles: string[],
  diffWarnings: DiffWarning[],
): ContextPack {
  const summary = diffWarnings.length === 0
    ? `No historical warnings for this diff (${changedFiles.length} file${changedFiles.length !== 1 ? 's' : ''} changed)`
    : `${diffWarnings.length} warning${diffWarnings.length !== 1 ? 's' : ''} across ${changedFiles.length} changed file${changedFiles.length !== 1 ? 's' : ''}`;

  return {
    query: `diff ${baseRef}..${headRef}`,
    answerSummary: summary,
    cards: [],
    warnings: diffWarnings.map(w => `[${w.severity.toUpperCase()}] ${w.filePath}: ${w.message}`),
  };
}

export function cardsContextPack(
  filterDescription: string,
  cards: InsightCard[],
  headSha: string,
  cacheHit: boolean,
): ContextPack {
  return {
    query: filterDescription,
    answerSummary: `${cards.length} card${cards.length !== 1 ? 's' : ''} at ${headSha.slice(0, 12)}${cacheHit ? ' (cached)' : ''}`,
    cards: cards.map(cardToContextCard),
    warnings: cacheHit ? [] : ['Cards were generated fresh (not from cache)'],
  };
}
