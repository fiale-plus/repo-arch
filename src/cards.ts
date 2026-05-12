import * as crypto from 'node:crypto';
import { type ClassifiedCommit } from './signals.js';

export type CardType =
  | 'churn-hotspot'
  | 'repeated-fix'
  | 'rationale-cluster'
  | 'test-gap'
  | 'revert-pattern'
  | 'co-change';

export type CardStatus = 'pending' | 'accepted' | 'rejected' | 'stale' | 'superseded';

export type InsightCard = {
  id: string;
  type: CardType;
  title: string;
  confidence: number;
  status: CardStatus;
  supportingCommits: { sha: string; subject: string }[];
  affectedFiles: string[];
  suggestion: string;
};

export type CardsOptions = {
  repoPath?: string;
  outPath?: string;
  minConfidence?: number;
  maxCards?: number;
};

export type CardsResult = {
  repoRoot: string;
  headSha: string;
  count: number;
  cards: InsightCard[];
  jsonl: string;
};

export function cardIdFrom(type: CardType, title: string, affectedFiles: string[]): string {
  const raw = JSON.stringify({ type, title, files: [...affectedFiles].sort() });
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

function toCard(data: { type: CardType; title: string; confidence: number; supportingCommits: { sha: string; subject: string }[]; affectedFiles: string[]; suggestion: string }, statusOverride?: CardStatus): InsightCard {
  return {
    ...data,
    id: cardIdFrom(data.type, data.title, data.affectedFiles),
    status: statusOverride ?? 'pending',
  };
}

// ─── Generators ────────────────────────────────────────────

function churnHotspotCards(records: ClassifiedCommit[]): Omit<InsightCard, 'id' | 'status'>[] {
  const fileCount = new Map<string, number>();
  for (const record of records) {
    const seen = new Set<string>();
    for (const file of record.files) {
      if (!seen.has(file.path)) {
        seen.add(file.path);
        fileCount.set(file.path, (fileCount.get(file.path) ?? 0) + 1);
      }
    }
  }

  const sorted = [...fileCount.entries()].sort((a, b) => b[1] - a[1]);
  const threshold = Math.max(2, Math.round(records.length * 0.08));
  const hotspots = sorted.filter(([, count]) => count >= threshold).slice(0, 5);

  return hotspots.map(([file, count]) => ({
    type: 'churn-hotspot',
    title: `High-churn file: ${file}`,
    confidence: Math.min(0.9, parseFloat((0.4 + (count / records.length) * 0.5).toFixed(2))),
    status: 'pending',
    supportingCommits: records
      .filter(r => r.files.some(f => f.path === file))
      .slice(0, 5)
      .map(r => ({ sha: r.sha, subject: r.subject })),
    affectedFiles: [file],
    suggestion: `Changed in ${count} commits. Consider whether this file needs refactoring, splitting, or a stabilization pass.`,
  }));
}

function repeatedFixCards(records: ClassifiedCommit[]): Omit<InsightCard, 'id' | 'status'>[] {
  const fixRecords = records.filter(r => r.signals.some(s => s.type === 'fix'));
  const fileCount = new Map<string, { count: number; commits: ClassifiedCommit[] }>();

  for (const record of fixRecords) {
    const seen = new Set<string>();
    for (const file of record.files) {
      if (!seen.has(file.path)) {
        seen.add(file.path);
        const entry = fileCount.get(file.path) ?? { count: 0, commits: [] };
        entry.count += 1;
        entry.commits.push(record);
        fileCount.set(file.path, entry);
      }
    }
  }

  return [...fileCount.entries()]
    .filter(([, entry]) => entry.count >= 2)
    .slice(0, 5)
    .map(([file, entry]) => ({
      type: 'repeated-fix',
      title: `Repeated fixes in: ${file}`,
      confidence: Math.min(0.95, parseFloat((0.5 + (entry.count - 1) * 0.1).toFixed(2))),
      supportingCommits: entry.commits.slice(0, 5).map(r => ({ sha: r.sha, subject: r.subject })),
      affectedFiles: [file],
      suggestion: `This file was fixed ${entry.count} times. Consider adding regression tests or a deeper refactor to address root cause.`,
    }));
}

function rationaleClusterCards(records: ClassifiedCommit[]): Omit<InsightCard, 'id' | 'status'>[] {
  const rationaleRecords = records.filter(r => r.signals.some(s => s.type === 'rationale'));
  if (rationaleRecords.length === 0) return [];

  // Group by top-level directory
  const dirMap = new Map<string, ClassifiedCommit[]>();
  for (const record of rationaleRecords) {
    const dirs = new Set<string>();
    for (const file of record.files) {
      const parts = file.path.split('/');
      const top = parts.length > 1 ? parts[0] : '<root>';
      dirs.add(top);
    }
    for (const dir of dirs) {
      const list = dirMap.get(dir) ?? [];
      list.push(record);
      dirMap.set(dir, list);
    }
  }

  return [...dirMap.entries()]
    .filter(([, records]) => records.length >= 2)
    .slice(0, 5)
    .map(([dir, commits]) => ({
      type: 'rationale-cluster',
      title: `Design rationale cluster: ${dir}/`,
      confidence: parseFloat((0.5 + commits.length * 0.05).toFixed(2)),
      supportingCommits: commits.slice(0, 5).map(r => ({ sha: r.sha, subject: r.subject })),
      affectedFiles: [...new Set(commits.flatMap(r => r.files.map(f => f.path)))].slice(0, 8),
      suggestion: `${commits.length} commits with explanatory messages in ${dir}/. These are good candidates for extracting explicit decision records.`,
    }));
}

function testGapCards(records: ClassifiedCommit[]): Omit<InsightCard, 'id' | 'status'>[] {
  const isTestPath = (p: string) => /\.(test|spec)\./.test(p) || /__tests__\//.test(p) || /\/test\//.test(p);

  const sourceFiles = new Map<string, number>();
  for (const record of records) {
    const hasTest = record.files.some(f => isTestPath(f.path));
    if (!hasTest) {
      for (const file of record.files) {
        if (!isTestPath(file.path) && !file.path.startsWith('.')) {
          sourceFiles.set(file.path, (sourceFiles.get(file.path) ?? 0) + 1);
        }
      }
    }
  }

  const filtered = [...sourceFiles.entries()]
    .filter(([, count]) => count >= Math.ceil(records.length * 0.05))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  return filtered.map(([file, count]) => ({
    type: 'test-gap',
    title: `Possible test gap: ${file}`,
    confidence: Math.min(0.7, parseFloat((0.4 + count * 0.03).toFixed(2))),
    supportingCommits: records
      .filter(r => r.files.some(f => f.path === file) && !r.files.some(f => isTestPath(f.path)))
      .slice(0, 5)
      .map(r => ({ sha: r.sha, subject: r.subject })),
    affectedFiles: [file],
    suggestion: `This file changed ${count} times without a corresponding test change. Review whether tests exist elsewhere or should be added.`,
  }));
}

function revertPatternCards(records: ClassifiedCommit[]): Omit<InsightCard, 'id' | 'status'>[] {
  const revertRecords = records.filter(r => r.signals.some(s => s.type === 'revert'));
  if (revertRecords.length === 0) return [];
  const revert = records.filter(r => r.signals.some(s => s.type === 'revert'));

  const revertedFiles = new Map<string, number>();
  for (const record of revert) {
    for (const file of record.files) {
      revertedFiles.set(file.path, (revertedFiles.get(file.path) ?? 0) + 1);
    }
  }

  const topFiles = [...revertedFiles.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([file, count]) => ({ file, count }));

  const suggestions = topFiles.length === 0
    ? [{ file: '<various>', count: revert.length }]
    : topFiles;

  return suggestions.map(({ file, count }) => ({
    type: 'revert-pattern',
    title: `Reversion pattern${file !== '<various>' ? `: ${file}` : ''}`,
    confidence: Math.min(0.9, parseFloat((0.6 + (revert.length / records.length) * 0.3).toFixed(2))),
    supportingCommits: revert.slice(0, 5).map(r => ({ sha: r.sha, subject: r.subject })),
    affectedFiles: file !== '<various>' ? [file] : [...new Set(revert.flatMap(r => r.files.map(f => f.path)))].slice(0, 8),
    suggestion: `${revert.length} revert commits found${file !== '<various>' ? ` affecting ${file}` : ''}. Reverted changes indicate instability — review before modifying these areas.`,
  }));
}

function coChangeCards(records: ClassifiedCommit[]): Omit<InsightCard, 'id' | 'status'>[] {
  const pairCount = new Map<string, number>();
  const pairCommits = new Map<string, ClassifiedCommit[]>();

  for (const record of records) {
    const files = record.files.map(f => f.path).filter(Boolean).sort();
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const key = `${files[i]} <-> ${files[j]}`;
        pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
        const commits = pairCommits.get(key) ?? [];
        commits.push(record);
        pairCommits.set(key, commits);
      }
    }
  }

  return [...pairCount.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([pairKey, count]) => {
      const [a, b] = pairKey.split(' <-> ');
      return {
        type: 'co-change',
        title: `Co-change cluster: ${a}, ${b}`,
        confidence: parseFloat((0.3 + count * 0.05).toFixed(2)),
        supportingCommits: (pairCommits.get(pairKey) ?? []).slice(0, 5).map(r => ({ sha: r.sha, subject: r.subject })),
        affectedFiles: [a, b],
        suggestion: `These files changed together in ${count} commits. Consider whether they should be colocated, refactored, or have shared tests.`,
      };
    });
}

// ─── Registry ──────────────────────────────────────────────

export const CARD_GENERATORS: Array<{
  type: CardType;
  label: string;
  run: (records: ClassifiedCommit[]) => Omit<InsightCard, 'id' | 'status'>[];
}> = [
  { type: 'churn-hotspot', label: 'Churn hotspots', run: churnHotspotCards },
  { type: 'repeated-fix', label: 'Repeated fix areas', run: repeatedFixCards },
  { type: 'rationale-cluster', label: 'Design rationale clusters', run: rationaleClusterCards },
  { type: 'test-gap', label: 'Test gaps', run: testGapCards },
  { type: 'revert-pattern', label: 'Reversion patterns', run: revertPatternCards },
  { type: 'co-change', label: 'Co-change clusters', run: coChangeCards },
];

// ─── Orchestrator ──────────────────────────────────────────

export function generateCards(
  classifiedRecords: ClassifiedCommit[],
  options: { minConfidence?: number; maxCards?: number } = {},
  statusOverrides?: Record<string, CardStatus>,
): InsightCard[] {
  const minConfidence = options.minConfidence ?? 0.3;
  const maxCards = options.maxCards ?? 20;

  const allCards: Omit<InsightCard, 'id' | 'status'>[] = [];
  for (const generator of CARD_GENERATORS) {
    const cards = generator.run(classifiedRecords);
    allCards.push(...cards);
  }

  return allCards
    .filter(card => card.confidence >= minConfidence)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, maxCards)
    .map(data => toCard(data, statusOverrides?.[cardIdFrom(data.type, data.title, data.affectedFiles)]));
}
