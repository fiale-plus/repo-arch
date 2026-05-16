import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

export type GitFileChange = {
  status: string;
  path: string;
  oldPath?: string;
};

export type GitHistoryRecord = {
  sha: string;
  parents: string[];
  author: { name: string; email: string };
  authoredAt: string;
  subject: string;
  files: GitFileChange[];
  paths: string[];
  /** Detected package/workspace for monorepo support */
  packageId?: string;
};

export type MineHistoryOptions = {
  repoPath?: string;
  outPath?: string;
};

export type MineHistoryResult = {
  repoRoot: string;
  headSha: string;
  cacheHit: boolean;
  cacheFile: string;
  count: number;
  records: GitHistoryRecord[];
  jsonl: string;
};

export function runGit(repoPath: string, args: string[]): string {
  return execFileSync('git', ['-C', repoPath, ...args], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
}

export function resolveRepoRoot(repoPath = process.cwd()): string {
  const resolved = path.resolve(repoPath);
  const root = runGit(resolved, ['rev-parse', '--show-toplevel']).trim();
  if (!root) throw new Error(`Unable to resolve git repo root from ${resolved}`);
  return root;
}

export function getHeadSha(repoRoot: string): string {
  return runGit(repoRoot, ['rev-parse', 'HEAD']).trim();
}

export function cacheKeyFor({ repoRoot, headSha, version = 1 }: { repoRoot: string; headSha: string; version?: number }): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ repoRoot, headSha, version }))
    .digest('hex');
}

export function cacheFileFor(repoRoot: string, cacheKey: string): string {
  return path.join(repoRoot, '.repo-arch', 'cache', `history-${cacheKey}.jsonl`);
}

function ensureDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function parseGitHistory(logOutput: string): GitHistoryRecord[] {
  const records: GitHistoryRecord[] = [];
  let current: GitHistoryRecord | null = null;

  const pushCurrent = (): void => {
    if (!current) return;
    current.paths = current.files.map(file => file.path);
    // Detect package from first file path
    current.packageId = detectPackage(current.paths[0] ?? '');
    records.push(current);
    current = null;
  };

  for (const rawLine of logOutput.split(/\r?\n/)) {
    if (!rawLine) continue;
    if (rawLine.startsWith('@@@')) {
      pushCurrent();
      const meta = rawLine.slice(3).split('\x1f');
      const [sha, parentsStr = '', authorName = '', authorEmail = '', authoredAt = '', subject = ''] = meta;
      current = {
        sha,
        parents: parentsStr ? parentsStr.split(' ').filter(Boolean) : [],
        author: { name: authorName, email: authorEmail },
        authoredAt,
        subject,
        files: [],
        paths: []
      };
      continue;
    }

    if (!current) continue;
    const parts = rawLine.split('\t');
    const status = parts[0] || '';
    if (!status) continue;

    if ((status.startsWith('R') || status.startsWith('C')) && parts.length >= 3) {
      current.files.push({ status, path: parts[2], oldPath: parts[1] });
    } else {
      current.files.push({ status, path: parts[1] || '' });
    }
  }

  pushCurrent();
  return records;
}

export function mineHistory({ repoPath, outPath }: MineHistoryOptions = {}): MineHistoryResult {
  const repoRoot = resolveRepoRoot(repoPath);
  const headSha = getHeadSha(repoRoot);
  const cacheKey = cacheKeyFor({ repoRoot, headSha, version: 1 });
  const cacheFile = cacheFileFor(repoRoot, cacheKey);

  let cacheHit = false;
  let records: GitHistoryRecord[];

  if (fs.existsSync(cacheFile)) {
    cacheHit = true;
    const cached = fs.readFileSync(cacheFile, 'utf8');
    records = cached.trim() ? cached.trim().split(/\r?\n/).map(line => JSON.parse(line) as GitHistoryRecord) : [];
  } else {
    const logOutput = runGit(repoRoot, [
      'log',
      '--reverse',
      '--date=iso-strict',
      '--format=@@@%H%x1f%P%x1f%an%x1f%ae%x1f%ad%x1f%s',
      '--name-status',
      '--find-renames=50%'
    ]);
    records = parseGitHistory(logOutput);
    // Deduplicate by SHA
    const seenShas = new Set<string>();
    records = records.filter(r => {
      if (seenShas.has(r.sha)) return false;
      seenShas.add(r.sha);
      return true;
    });
    const jsonl = records.map(record => JSON.stringify(record)).join('\n') + (records.length ? '\n' : '');
    ensureDir(cacheFile);
    fs.writeFileSync(cacheFile, jsonl, 'utf8');
  }

  const jsonl = records.map(record => JSON.stringify(record)).join('\n') + (records.length ? '\n' : '');
  if (outPath) {
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(outPath, jsonl, 'utf8');
  }

  return {
    repoRoot,
    headSha,
    cacheHit,
    cacheFile,
    count: records.length,
    records,
    jsonl
  };
}

/**
 * Detect package/workspace from a file path.
 * Checks for common monorepo package roots.
 */
export function detectPackage(filePath: string): string {
  // Check for packages/ prefix (npm workspaces)
  const pkgMatch = filePath.match(/^(packages\/[^/]+)/);
  if (pkgMatch) return pkgMatch[1];

  // Check for apps/ prefix (turborepo style)
  const appMatch = filePath.match(/^(apps\/[^/]+)/);
  if (appMatch) return appMatch[1];

  // Check for libs/ prefix (nx style)
  const libMatch = filePath.match(/^(libs\/[^/]+)/);
  if (libMatch) return libMatch[1];

  // Root-level files
  const parts = filePath.split('/');
  if (parts.length === 1) return '<root>';
  return '<root>';  // not detected in a known workspace layout
}

/**
 * Generate a stable dedup key for a git file change.
 * Used to prevent duplicate history records.
 */
export function fileDedupKey(sha: string, filePath: string): string {
  return crypto.createHash('sha256')
    .update(`${sha}:${filePath}`)
    .digest('hex')
    .slice(0, 32);
}
