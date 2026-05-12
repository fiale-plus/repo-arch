import * as fs from 'node:fs';
import * as path from 'node:path';
import { runGit, resolveRepoRoot } from './git-history.js';
import type { InsightCard, CardType } from './cards.js';

export type StaleStatus = 'fresh' | 'partial' | 'stale';

export type StalenessResult = {
  cardId: string;
  type: CardType;
  title: string;
  status: StaleStatus;
  missingFiles: string[];
  existingFiles: string[];
  /** Whether referenced commits are still reachable in history */
  commitsReachable: boolean;
  /** HEAD at time of check */
  checkedAtHead: string;
};

export type StalenessOptions = {
  repoPath?: string;
};

export type StalenessSummary = {
  repoRoot: string;
  checkedAtHead: string;
  total: number;
  fresh: number;
  partial: number;
  stale: number;
  results: StalenessResult[];
};

function fileExists(repoRoot: string, filePath: string): boolean {
  return fs.existsSync(path.join(repoRoot, filePath));
}

function commitsReachable(repoRoot: string, shas: string[]): boolean {
  if (shas.length === 0) return true;
  try {
    runGit(repoRoot, ['cat-file', '--batch-check']);
    // Check each sha individually
    for (const sha of shas) {
      try {
        runGit(repoRoot, ['cat-file', '-e', sha]);
      } catch {
        return false;
      }
    }
    return true;
  } catch {
    // fallback: try a single merge-base check
    try {
      runGit(repoRoot, ['merge-base', '--is-ancestor', shas[0]!, 'HEAD']);
      return true;
    } catch {
      return false;
    }
  }
}

export function checkStaleness(cards: InsightCard[], options: StalenessOptions = {}): StalenessSummary {
  const repoRoot = resolveRepoRoot(options.repoPath);
  const headSha = runGit(repoRoot, ['rev-parse', 'HEAD']).trim();

  const results: StalenessResult[] = cards.map(card => {
    const existing: string[] = [];
    const missing: string[] = [];

    for (const file of card.affectedFiles) {
      if (fileExists(repoRoot, file)) {
        existing.push(file);
      } else {
        missing.push(file);
      }
    }

    let status: StaleStatus = 'fresh';
    if (missing.length > 0 && existing.length > 0) {
      status = 'partial';
    } else if (missing.length > 0 && existing.length === 0) {
      status = 'stale';
    }

    const commitShas = card.supportingCommits.map(c => c.sha);

    return {
      cardId: card.id,
      type: card.type,
      title: card.title,
      status,
      missingFiles: missing,
      existingFiles: existing,
      commitsReachable: commitsReachable(repoRoot, commitShas),
      checkedAtHead: headSha,
    };
  });

  const fresh = results.filter(r => r.status === 'fresh').length;
  const partial = results.filter(r => r.status === 'partial').length;
  const stale = results.filter(r => r.status === 'stale').length;

  return {
    repoRoot,
    checkedAtHead: headSha,
    total: results.length,
    fresh,
    partial,
    stale,
    results,
  };
}

export function formatStaleness(summary: StalenessSummary): string {
  const lines: string[] = [];

  if (summary.total === 0) {
    lines.push('\n  No cards to check.\n');
    return lines.join('\n');
  }

  const statusIcon = (s: StaleStatus) => s === 'fresh' ? '✅' : s === 'partial' ? '🟡' : '🔴';

  lines.push(`\n  Staleness check for ${summary.repoRoot}`);
  lines.push(`  ${summary.checkedAtHead.slice(0, 12)} | ${summary.total} cards`);
  lines.push(`  ${summary.fresh} fresh · ${summary.partial} partial · ${summary.stale} stale\n`);

  for (const result of summary.results) {
    if (result.status !== 'stale' && result.status !== 'partial') continue;
    lines.push(`  ${statusIcon(result.status)} [${result.status.toUpperCase()}] ${result.title}`);

    if (result.missingFiles.length > 0) {
      lines.push(`     Missing files:`);
      for (const f of result.missingFiles) {
        lines.push(`       · ${f}`);
      }
    }

    if (!result.commitsReachable) {
      lines.push(`     ⚠ Referenced commits no longer reachable in history`);
    }
    lines.push('');
  }

  if (summary.stale === 0 && summary.partial === 0) {
    lines.push(`  All cards reference files that still exist.\n`);
  }

  return lines.join('\n');
}
