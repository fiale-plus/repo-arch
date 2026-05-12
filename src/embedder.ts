import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveRepoRoot, getHeadSha } from './git-history.js';

export const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const EMBEDDING_DIM = 384;

export type EmbedderConfig = {
  model?: string;
};

export type VectorEntry = {
  id: string;
  text: string;
  embedding: number[];
  source: 'card' | 'commit';
  metadata: Record<string, string>;
};

export type VectorIndex = {
  model: string;
  dim: number;
  headSha: string;
  entries: VectorEntry[];
  createdAt: string;
};

let extractor: any = null;

function ensureCacheDir(repoRoot: string): string {
  const dir = path.join(repoRoot, '.repo-arch', 'index');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function indexFilePath(repoRoot: string): string {
  return path.join(ensureCacheDir(repoRoot), 'vectors.json');
}

function cacheKey(repoRoot: string, headSha: string): string {
  return crypto.createHash('sha256').update(JSON.stringify({ repoRoot, headSha, model: DEFAULT_MODEL })).digest('hex');
}

export async function loadExtractor(config: EmbedderConfig = {}): Promise<any> {
  if (extractor) return extractor;
  try {
    const { pipeline } = await import('@huggingface/transformers');
    extractor = await pipeline('feature-extraction', config.model ?? DEFAULT_MODEL);
    return extractor;
  } catch (error) {
    throw new Error(
      `Failed to load embedding model. Install with: npm install @huggingface/transformers\n  ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function embed(text: string, config: EmbedderConfig = {}): Promise<number[]> {
  const pipe = await loadExtractor(config);
  const result = await pipe(text, { pooling: 'mean', normalize: true });
  return Array.from(result.data) as number[];
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

export function loadIndex(repoRoot: string): VectorIndex | null {
  const filePath = indexFilePath(repoRoot);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as VectorIndex;
  } catch {
    return null;
  }
}

export function saveIndex(repoRoot: string, index: VectorIndex): void {
  fs.writeFileSync(indexFilePath(repoRoot), JSON.stringify(index, null, 2), 'utf8');
}

export async function buildIndex(
  entries: { id: string; text: string; source: 'card' | 'commit'; metadata: Record<string, string> }[],
  options: { repoPath?: string; model?: string } = {},
): Promise<VectorIndex> {
  const repoRoot = resolveRepoRoot(options.repoPath);
  const headSha = getHeadSha(repoRoot);
  const pipe = await loadExtractor(options);

  const vectorEntries: VectorEntry[] = [];
  for (const entry of entries) {
    const embedding = await embed(entry.text, options);
    vectorEntries.push({ ...entry, embedding });
  }

  const index: VectorIndex = {
    model: options.model ?? DEFAULT_MODEL,
    dim: EMBEDDING_DIM,
    headSha,
    entries: vectorEntries,
    createdAt: new Date().toISOString(),
  };

  saveIndex(repoRoot, index);
  return index;
}

export function searchIndex(
  index: VectorIndex,
  queryEmbedding: number[],
  topK: number = 5,
): { entry: VectorEntry; score: number }[] {
  const scored = index.entries.map(entry => ({
    entry,
    score: cosineSimilarity(queryEmbedding, entry.embedding),
  }));

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
