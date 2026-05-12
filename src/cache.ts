import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getHeadSha } from './git-history.js';
import type { InsightCard } from './cards.js';

export const CACHE_VERSION = 1;

export type CardCacheEntry = {
  version: number;
  headSha: string;
  createdAt: string;
  cards: InsightCard[];
};

function cacheDir(repoRoot: string): string {
  return path.join(repoRoot, '.repo-arch', 'cache', 'cards');
}

function cacheFilePath(repoRoot: string, headSha: string): string {
  return path.join(cacheDir(repoRoot), `${headSha}.json`);
}

export function getCachedCards(repoRoot: string, headSha: string): CardCacheEntry | null {
  const filePath = cacheFilePath(repoRoot, headSha);
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const entry = JSON.parse(raw) as CardCacheEntry;
    if (entry.version !== CACHE_VERSION) return null;
    if (entry.headSha !== headSha) return null;
    return entry;
  } catch {
    return null;
  }
}

export function writeCachedCards(repoRoot: string, headSha: string, cards: InsightCard[]): void {
  const dir = cacheDir(repoRoot);
  fs.mkdirSync(dir, { recursive: true });

  // Remove stale cache files for other HEADs to prevent bloat
  cleanupStaleCaches(dir, headSha);

  const entry: CardCacheEntry = {
    version: CACHE_VERSION,
    headSha,
    createdAt: new Date().toISOString(),
    cards,
  };
  fs.writeFileSync(cacheFilePath(repoRoot, headSha), JSON.stringify(entry, null, 2), 'utf8');
}

export function invalidateCache(repoRoot: string): number {
  const dir = cacheDir(repoRoot);
  if (!fs.existsSync(dir)) return 0;

  let removed = 0;
  for (const file of fs.readdirSync(dir)) {
    if (file.endsWith('.json')) {
      fs.rmSync(path.join(dir, file));
      removed++;
    }
  }
  return removed;
}

function cleanupStaleCaches(dir: string, keepHead: string, maxFiles: number = 10): void {
  if (!fs.existsSync(dir)) return;

  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => ({
      name: f,
      head: f.replace(/\.json$/, ''),
      mtime: fs.statSync(path.join(dir, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime); // newest first

  // Keep the current HEAD's cache and up to maxFiles-1 others
  const toRemove = files.filter(f => f.head !== keepHead).slice(maxFiles - 1);
  for (const f of toRemove) {
    fs.rmSync(path.join(dir, f.name));
  }
}

export function cacheHeadFor(repoRoot: string, options: { repoPath?: string } = {}): string {
  return getHeadSha(repoRoot);
}

export function cachedOrGenerate(
  repoRoot: string,
  generate: () => InsightCard[],
): { cards: InsightCard[]; cacheHit: boolean; headSha: string } {
  const headSha = cacheHeadFor(repoRoot);
  const cached = getCachedCards(repoRoot, headSha);

  if (cached) {
    return { cards: cached.cards, cacheHit: true, headSha };
  }

  const cards = generate();
  writeCachedCards(repoRoot, headSha, cards);
  return { cards, cacheHit: false, headSha };
}
