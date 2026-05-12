import { mineHistory, runGit, resolveRepoRoot, type GitFileChange } from './git-history.js';
import { classifyHistory, type ClassifiedCommit, type CommitSignal } from './signals.js';
import { generateCards, type InsightCard } from './cards.js';

export type DiffWarning = {
  filePath: string;
  type: 'repeated-fix' | 'test-gap' | 'revert-pattern' | 'co-change-reminder';
  severity: 'low' | 'medium' | 'high';
  message: string;
  evidence: string;
  confidence: number;
};

export type CheckDiffOptions = {
  repoPath?: string;
  base?: string;
  head?: string;
};

export type CheckDiffResult = {
  repoRoot: string;
  baseSha: string;
  headSha: string;
  changedFiles: string[];
  warnings: DiffWarning[];
};

function getChangedFiles(repoRoot: string, base: string, head: string): { status: string; path: string }[] {
  const output = runGit(repoRoot, [
    'diff', '--name-status', '--no-renames', `${base}..${head}`,
  ]).trim();

  if (!output) return [];
  return output.split(/\r?\n/).filter(Boolean).map(line => {
    const [status, path] = line.split(/\t/);
    return { status: status ?? 'M', path: path ?? '' };
  });
}

function getBaseAndHead(repoRoot: string, options: CheckDiffOptions): { base: string; head: string } {
  const base = options.base ?? 'HEAD~1';
  const head = options.head ?? 'HEAD';
  const baseSha = runGit(repoRoot, ['rev-parse', base]).trim();
  const headSha = runGit(repoRoot, ['rev-parse', head]).trim();
  return { base: baseSha, head: headSha };
}

function severityFor(confidence: number, type: string): 'low' | 'medium' | 'high' {
  if (type === 'revert-pattern') return 'high';
  if (type === 'repeated-fix') return confidence >= 0.7 ? 'high' : confidence >= 0.5 ? 'medium' : 'low';
  if (type === 'test-gap') return 'medium';
  if (type === 'co-change-reminder') return 'low';
  return 'low';
}

function warningsForFile(
  filePath: string,
  status: string,
  classified: ClassifiedCommit[],
  cards: InsightCard[],
): DiffWarning[] {
  const warnings: DiffWarning[] = [];
  const touchingCommits = classified.filter(r => r.files.some(f => f.path === filePath));
  if (touchingCommits.length === 0) return warnings;

  const fileCards = cards.filter(c => c.affectedFiles.includes(filePath));

  // Check repeat-fix card for this file
  for (const card of fileCards) {
    if (card.type === 'repeated-fix') {
      warnings.push({
        filePath,
        type: 'repeated-fix',
        severity: severityFor(card.confidence, 'repeated-fix'),
        message: `This file was fixed ${card.supportingCommits.length} times previously. Changes here risk reintroducing past bugs.`,
        evidence: card.supportingCommits.map(c => `  · ${c.subject} (${c.sha})`).join('\n'),
        confidence: card.confidence,
      });
    }

    if (card.type === 'revert-pattern') {
      warnings.push({
        filePath,
        type: 'revert-pattern',
        severity: 'high',
        message: `This file has been reverted before — changes here need extra caution.`,
        evidence: card.supportingCommits.map(c => `  · ${c.subject} (${c.sha})`).join('\n'),
        confidence: card.confidence,
      });
    }
  }

  // Check test gap: if adding/modifying non-test source file without test companion
  if (status !== 'D' && !/\.(test|spec)\./.test(filePath) && !/__tests__\//.test(filePath) && !/\/test\//.test(filePath)) {
    const isTestPath = (p: string) => /\.(test|spec)\./.test(p) || /__tests__\//.test(p) || /\/test\//.test(p);
    const hasTestCompanion = touchingCommits.some(c =>
      c.files.some(f => isTestPath(f.path) && f.path.replace(/\.(test|spec)\./, '.').split('/').pop() === filePath.split('/').pop()),
    );
    if (!hasTestCompanion) {
      warnings.push({
        filePath,
        type: 'test-gap',
        severity: 'medium',
        message: `History shows changes to this file without co-occurring test updates. Consider adding or updating tests.`,
        evidence: `${touchingCommits.length} commits touching this file.`,
        confidence: 0.5,
      });
    }
  }

  // Co-change reminder: check for partners that aren't in this diff
  const partnerMap = new Map<string, number>();
  for (const commit of touchingCommits) {
    const seen = new Set<string>();
    for (const file of commit.files) {
      if (file.path !== filePath && !seen.has(file.path)) {
        seen.add(file.path);
        partnerMap.set(file.path, (partnerMap.get(file.path) ?? 0) + 1);
      }
    }
  }

  const topPartners = [...partnerMap.entries()]
    .filter(([, count]) => count >= Math.min(2, touchingCommits.length * 0.3))
    .slice(0, 3);

  if (topPartners.length > 0) {
    warnings.push({
      filePath,
      type: 'co-change-reminder',
      severity: 'low',
      message: `This file historically changes alongside: ${topPartners.map(([p]) => p).join(', ')}. Verify they don't need updates too.`,
      evidence: topPartners.map(([p, c]) => `  · ${p} (${c} time${c !== 1 ? 's' : ''})`).join('\n'),
      confidence: Math.min(0.7, 0.3 + touchingCommits.length * 0.02),
    });
  }

  return warnings;
}

export function checkDiff(options: CheckDiffOptions = {}): CheckDiffResult {
  const repoRoot = resolveRepoRoot(options.repoPath);
  const { base, head } = getBaseAndHead(repoRoot, options);

  const changedFiles = getChangedFiles(repoRoot, base, head);
  const changedPaths = changedFiles.map(f => f.path);

  // Run the full pipeline once
  const history = mineHistory({ repoPath: repoRoot });
  const classified = classifyHistory(history.records);
  const cards = generateCards(classified, { minConfidence: 0.3 });

  const warnings: DiffWarning[] = [];
  for (const { path: filePath, status } of changedFiles) {
    const fileWarnings = warningsForFile(filePath, status, classified, cards);
    warnings.push(...fileWarnings);
  }

  // Sort by severity then confidence
  const severityOrder = { high: 0, medium: 1, low: 2 };
  warnings.sort((a, b) => {
    const sevDiff = (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99);
    if (sevDiff !== 0) return sevDiff;
    return b.confidence - a.confidence;
  });

  return {
    repoRoot,
    baseSha: base,
    headSha: head,
    changedFiles: changedPaths,
    warnings,
  };
}

export function formatCheckDiff(result: CheckDiffResult): string {
  const lines: string[] = [];
  lines.push('');

  if (result.warnings.length === 0) {
    lines.push(`  ✅ No historical warnings for this diff.`);
    lines.push(`  (${result.changedFiles.length} file${result.changedFiles.length !== 1 ? 's' : ''} changed)`);
    lines.push('');
    return lines.join('\n');
  }

  for (const { filePath, type, severity, message, evidence, confidence } of result.warnings) {
    const icon = severity === 'high' ? '🔴' : severity === 'medium' ? '🟡' : '🟢';
    const tag = severity.toUpperCase();
    lines.push(`  ${icon} [${tag}] ${filePath}`);
    lines.push(`     ${message}`);
    lines.push(`     ${evidence.replace(/\n/g, '\n     ')}`);
    lines.push(`     confidence: ${confidence}`);
    lines.push('');
  }

  lines.push(`  ${result.warnings.length} warning${result.warnings.length !== 1 ? 's' : ''} across ${result.changedFiles.length} changed file${result.changedFiles.length !== 1 ? 's' : ''}.`);
  lines.push('');

  return lines.join('\n');
}
