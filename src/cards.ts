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

  const candidates = [...fileCount.entries()]
    .map(([file, count]) => ({
      file,
      count,
      bucket: isSourcePath(file) ? 'source' : isConfigPath(file) ? 'config' : 'other' as CardBucket,
    }))
    .filter(candidate => candidate.count >= Math.max(2, Math.round(records.length * (candidate.bucket === 'source' ? 0.03 : 0.08))))
    .sort((a, b) => b.count - a.count);

  const hotspots = selectByBucket(candidates, { source: 3, config: 1, other: 1 }, 5);

  return hotspots.map(({ file, count }) => ({
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

function isChangelog(filePath: string): boolean {
  const name = filePath.split('/').pop() ?? '';
  return /^CHANGELOG/i.test(name);
}

function isLockFile(filePath: string): boolean {
  return /package-lock\.json$/.test(filePath);
}

function repeatedFixCards(records: ClassifiedCommit[]): Omit<InsightCard, 'id' | 'status'>[] {
  const fixRecords = records.filter(r => r.signals.some(s => s.type === 'fix'));
  const fileCount = new Map<string, { count: number; commits: ClassifiedCommit[]; bucket: CardBucket }>();

  for (const record of fixRecords) {
    const seen = new Set<string>();
    for (const file of record.files) {
      if (!seen.has(file.path)) {
        if (isChangelog(file.path)) continue;
        seen.add(file.path);
        const bucket: CardBucket = isSourcePath(file.path) ? 'source' : isConfigPath(file.path) ? 'config' : 'other';
        const entry = fileCount.get(file.path) ?? { count: 0, commits: [], bucket };
        entry.count += 1;
        entry.commits.push(record);
        fileCount.set(file.path, entry);
      }
    }
  }

  const entries = [...fileCount.entries()]
    .filter(([, entry]) => entry.count >= 2)
    .map(([file, entry]) => ({ file, ...entry }))
    .sort((a, b) => b.count - a.count);

  const selected = selectByBucket(entries, { source: 3, config: 2, other: 0 }, 5);

  return selected.map(({ file, count, commits }) => ({
    type: 'repeated-fix',
    title: `Repeated fixes in: ${file}`,
    confidence: Math.min(0.95, parseFloat((0.5 + (count - 1) * 0.1).toFixed(2))),
    supportingCommits: commits.slice(0, 5).map(r => ({ sha: r.sha, subject: r.subject })),
    affectedFiles: [file],
    suggestion: `This file was fixed ${count} times. Consider adding regression tests or a deeper refactor to address root cause.`,
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

  const sourceFiles = new Map<string, { count: number; bucket: CardBucket }>();
  for (const record of records) {
    const hasTest = record.files.some(f => isTestPath(f.path));
    if (!hasTest) {
      for (const file of record.files) {
        if (!isTestPath(file.path) && !file.path.startsWith('.')) {
          if (isChangelog(file.path) || isLockFile(file.path)) continue;
          const bucket: CardBucket = isSourcePath(file.path) ? 'source' : isConfigPath(file.path) ? 'config' : 'other';
          const entry = sourceFiles.get(file.path) ?? { count: 0, bucket };
          entry.count += 1;
          sourceFiles.set(file.path, entry);
        }
      }
    }
  }

  const filtered = [...sourceFiles.entries()]
    .filter(([, entry]) => entry.count >= Math.ceil(records.length * 0.05))
    .map(([file, entry]) => ({ file, ...entry }))
    .sort((a, b) => b.count - a.count);

  const selected = selectByBucket(filtered, { source: 3, config: 1, other: 0 }, 4);

  return selected.map(({ file, count }) => ({
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

  const pairs = [...pairCount.entries()]
    .filter(([, count]) => count >= 2)
    .map(([pairKey, count]) => {
      const [a, b] = pairKey.split(' <-> ');
      const bucket: CardBucket = isSourcePath(a) || isSourcePath(b) ? 'source' : isConfigPath(a) || isConfigPath(b) ? 'config' : 'other';
      return { pairKey, count, a, b, bucket, commits: pairCommits.get(pairKey) ?? [] };
    })
    .sort((a, b) => b.count - a.count);

  const selected = selectByBucket(pairs, { source: 3, config: 2, other: 0 }, 5);

  return selected.map(({ pairKey, count, a, b, commits }) => ({
    type: 'co-change',
    title: `Co-change cluster: ${a}, ${b}`,
    confidence: parseFloat((0.3 + count * 0.05).toFixed(2)),
    supportingCommits: commits.slice(0, 5).map(r => ({ sha: r.sha, subject: r.subject })),
    affectedFiles: [a, b],
    suggestion: `These files changed together in ${count} commits. Consider whether they should be colocated, refactored, or have shared tests.`,
  }));
}

type CardBucket = 'source' | 'config' | 'rationale' | 'other';

type ScoredCard = Omit<InsightCard, 'id' | 'status'> & { key: string; bucket: CardBucket };

function isSourcePath(filePath: string): boolean {
  return /\.(?:d\.)?(?:ts|tsx|js|jsx|mjs|cjs|mts|cts|go|rs|py|java|kt|swift|rb|c|cc|cpp|cxx|h|hpp|hh|cs|m|mm|sh)$/i.test(filePath);
}

function isConfigPath(filePath: string): boolean {
  return /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|CHANGELOG(?:\.[^.]+)?|README(?:\.[^.]+)?|Dockerfile|Makefile|tsconfig(?:\.[^.]+)?\.json|eslint\.config\.[cm]?js|\.gitignore|\.npmrc|\.env(?:\.[^.]+)?)$/i.test(filePath)
    || /\.(?:json|ya?ml|toml|ini)$/i.test(filePath);
}

function classifyCardBucket(card: Omit<InsightCard, 'id' | 'status'>): CardBucket {
  if (card.type === 'rationale-cluster') return 'rationale';
  const files = card.affectedFiles ?? [];
  if (files.some(isSourcePath)) return 'source';
  if (files.some(isConfigPath)) return 'config';
  return 'other';
}

function selectByBucket<T extends { bucket: CardBucket }>(
  items: T[],
  quotas: Partial<Record<CardBucket, number>>,
  maxCount: number,
): T[] {
  const selected: T[] = [];
  const selectedSet = new Set<T>();
  const order: CardBucket[] = ['source', 'config', 'rationale', 'other'];

  for (const bucket of order) {
    let quota = quotas[bucket] ?? 0;
    if (quota <= 0) continue;
    for (const item of items) {
      if (selected.length >= maxCount || quota <= 0) break;
      if (item.bucket !== bucket || selectedSet.has(item)) continue;
      selected.push(item);
      selectedSet.add(item);
      quota -= 1;
    }
  }

  for (const item of items) {
    if (selected.length >= maxCount) break;
    if (selectedSet.has(item)) continue;
    selected.push(item);
    selectedSet.add(item);
  }

  return selected.slice(0, maxCount);
}

function sortDesc(a: ScoredCard, b: ScoredCard): number {
  return b.confidence - a.confidence;
}

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

  const allCards: ScoredCard[] = [];
  for (const generator of CARD_GENERATORS) {
    const cards = generator.run(classifiedRecords);
    for (const card of cards) {
      allCards.push({
        ...card,
        key: cardIdFrom(card.type, card.title, card.affectedFiles),
        bucket: classifyCardBucket(card),
      });
    }
  }

  const eligible = allCards
    .filter(card => card.confidence >= minConfidence)
    .sort(sortDesc);

  const buckets: Record<CardBucket, ScoredCard[]> = {
    source: [],
    config: [],
    rationale: [],
    other: [],
  };
  for (const card of eligible) {
    buckets[card.bucket].push(card);
  }

  const selected: ScoredCard[] = [];
  const selectedKeys = new Set<string>();
  const pushCard = (card: ScoredCard): void => {
    if (selected.length >= maxCards || selectedKeys.has(card.key)) return;
    selected.push(card);
    selectedKeys.add(card.key);
  };
  const take = (bucket: CardBucket, quota: number): void => {
    for (const card of buckets[bucket]) {
      if (selected.length >= maxCards) break;
      if (quota <= 0) break;
      if (selectedKeys.has(card.key)) continue;
      pushCard(card);
      quota -= 1;
    }
  };

  const sourceQuota = Math.min(Math.max(1, Math.round(maxCards * 0.45)), Math.min(10, maxCards));
  const configQuota = Math.min(Math.max(1, Math.round(maxCards * 0.25)), Math.max(0, maxCards - sourceQuota));
  const rationaleQuota = Math.min(Math.max(0, Math.round(maxCards * 0.15)), Math.max(0, maxCards - sourceQuota - configQuota));

  take('source', sourceQuota);
  take('config', configQuota);
  take('rationale', rationaleQuota);

  for (const card of eligible) {
    if (selected.length >= maxCards) break;
    if (selectedKeys.has(card.key)) continue;
    pushCard(card);
  }

  return selected
    .slice(0, maxCards)
    .map(data => toCard(data, statusOverrides?.[data.key]));
}
