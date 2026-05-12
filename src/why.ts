import { type ClassifiedCommit } from './signals.js';
import { type InsightCard, generateCards } from './cards.js';
import { mineHistory } from './git-history.js';
import { classifyHistory } from './signals.js';

export type CoChangePartner = {
  path: string;
  count: number;
};

export type WhyResult = {
  filePath: string;
  repoRoot: string;
  headSha: string;
  commitCount: number;
  /** Commits that touched this file */
  touchingCommits: ClassifiedCommit[];
  /** Signal counts scoped to this file */
  signalSummary: { type: string; label: string; count: number }[];
  fixCommits: { sha: string; subject: string }[];
  rationaleCommits: { sha: string; subject: string }[];
  revertCommits: { sha: string; subject: string }[];
  coChangePartners: CoChangePartner[];
  relatedCards: InsightCard[];
};

export function why(filePath: string, options: { repoPath?: string } = {}): WhyResult {
  const repoRoot = mineHistory({ repoPath: options.repoPath }).repoRoot;
  const history = mineHistory({ repoPath: options.repoPath });
  const classified = classifyHistory(history.records);
  const cards = generateCards(classified, { minConfidence: 0.3 });

  // Filter commits that touch the specified file
  const touchingCommits = classified.filter(record =>
    record.files.some(f => f.path === filePath || f.oldPath === filePath),
  );

  // Signal summary (deduplicate by type within each commit)
  const signalCount = new Map<string, { label: string; count: number }>();
  for (const commit of touchingCommits) {
    const seen = new Set<string>();
    for (const signal of commit.signals) {
      if (!seen.has(signal.type)) {
        seen.add(signal.type);
        const existing = signalCount.get(signal.type);
        if (existing) {
          existing.count += 1;
        } else {
          signalCount.set(signal.type, { label: signal.label, count: 1 });
        }
      }
    }
  }
  const signalSummary = [...signalCount.entries()]
    .map(([type, info]) => ({ type, label: info.label, count: info.count }))
    .sort((a, b) => b.count - a.count);

  // Categorize commits
  const fixCommits = touchingCommits
    .filter(c => c.signals.some(s => s.type === 'fix'))
    .map(c => ({ sha: c.sha.slice(0, 7), subject: c.subject }));

  const rationaleCommits = touchingCommits
    .filter(c => c.signals.some(s => s.type === 'rationale'))
    .map(c => ({ sha: c.sha.slice(0, 7), subject: c.subject }));

  const revertCommits = touchingCommits
    .filter(c => c.signals.some(s => s.type === 'revert'))
    .map(c => ({ sha: c.sha.slice(0, 7), subject: c.subject }));

  // Co-change partners
  const partnerMap = new Map<string, number>();
  for (const commit of touchingCommits) {
    for (const file of commit.files) {
      if (file.path !== filePath && file.path) {
        partnerMap.set(file.path, (partnerMap.get(file.path) ?? 0) + 1);
      }
    }
  }
  const coChangePartners = [...partnerMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([path, count]) => ({ path, count }));

  // Related cards
  const relatedCards = cards.filter(card =>
    card.affectedFiles.some(f => f === filePath),
  );

  return {
    filePath,
    repoRoot,
    headSha: history.headSha,
    commitCount: touchingCommits.length,
    touchingCommits,
    signalSummary,
    fixCommits,
    rationaleCommits,
    revertCommits,
    coChangePartners,
    relatedCards,
  };
}

export function formatWhy(result: WhyResult): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(`  📜 ${result.filePath}`);
  lines.push(`  ${result.repoRoot} @ ${result.headSha.slice(0, 12)}`);
  lines.push('');

  // Summary line
  const parts: string[] = [`${result.commitCount} commit${result.commitCount !== 1 ? 's' : ''}`];
  for (const sig of result.signalSummary) {
    parts.push(`${sig.count} ${sig.type}`);
  }
  lines.push(`  ${parts.join(' · ')}`);
  lines.push('');

  // Fix commits
  if (result.fixCommits.length > 0) {
    lines.push(`  ❌ Repeated fixes (${result.fixCommits.length}):`);
    for (const c of result.fixCommits) {
      lines.push(`    · ${c.subject} (${c.sha})`);
    }
    lines.push('');
  }

  // Rationale commits
  if (result.rationaleCommits.length > 0) {
    lines.push(`  💡 Rationale:`);
    for (const c of result.rationaleCommits) {
      lines.push(`    · ${c.subject} (${c.sha})`);
    }
    lines.push('');
  }

  // Revert commits
  if (result.revertCommits.length > 0) {
    lines.push(`  ↩ Reverted:`);
    for (const c of result.revertCommits) {
      lines.push(`    · ${c.subject} (${c.sha})`);
    }
    lines.push('');
  }

  // Co-change partners
  if (result.coChangePartners.length > 0) {
    lines.push(`  🔗 Co-changes:`);
    for (const p of result.coChangePartners.slice(0, 5)) {
      lines.push(`    · ${p.path} (${p.count} time${p.count !== 1 ? 's' : ''})`);
    }
    lines.push('');
  }

  // Related cards
  if (result.relatedCards.length > 0) {
    lines.push(`  ⚠️  Related cards:`);
    for (const card of result.relatedCards) {
      lines.push(`    · ${card.title} (confidence ${card.confidence})`);
    }
    lines.push('');
  }

  // Fallback
  if (result.commitCount === 0) {
    lines.push(`  No commits found touching this file. It may be untracked or new.`);
    lines.push('');
  }

  return lines.join('\n');
}
