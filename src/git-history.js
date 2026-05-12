const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function runGit(repoPath, args) {
  return execFileSync('git', ['-C', repoPath, ...args], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
}

function resolveRepoRoot(repoPath) {
  const resolved = path.resolve(repoPath || process.cwd());
  const root = runGit(resolved, ['rev-parse', '--show-toplevel']).trim();
  if (!root) throw new Error(`Unable to resolve git repo root from ${resolved}`);
  return root;
}

function getHeadSha(repoRoot) {
  return runGit(repoRoot, ['rev-parse', 'HEAD']).trim();
}

function cacheKeyFor({ repoRoot, headSha, version = 1 }) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ repoRoot, headSha, version }))
    .digest('hex');
}

function cacheFileFor(repoRoot, cacheKey) {
  return path.join(repoRoot, '.repo-arch', 'cache', `history-${cacheKey}.jsonl`);
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function parseGitHistory(logOutput) {
  const records = [];
  let current = null;

  const pushCurrent = () => {
    if (!current) return;
    current.paths = current.files.map(file => file.path);
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
        files: []
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

function mineHistory({ repoPath, outPath } = {}) {
  const repoRoot = resolveRepoRoot(repoPath);
  const headSha = getHeadSha(repoRoot);
  const cacheKey = cacheKeyFor({ repoRoot, headSha, version: 1 });
  const cacheFile = cacheFileFor(repoRoot, cacheKey);

  let cacheHit = false;
  let records;

  if (fs.existsSync(cacheFile)) {
    cacheHit = true;
    const cached = fs.readFileSync(cacheFile, 'utf8');
    records = cached.trim() ? cached.trim().split(/\r?\n/).map(line => JSON.parse(line)) : [];
  } else {
    const logOutput = runGit(repoRoot, [
      'log',
      '--reverse',
      '--date=iso-strict',
      `--format=@@@%H%x1f%P%x1f%an%x1f%ae%x1f%ad%x1f%s`,
      '--name-status',
      '--find-renames=50%'
    ]);
    records = parseGitHistory(logOutput);
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

module.exports = {
  runGit,
  resolveRepoRoot,
  getHeadSha,
  cacheKeyFor,
  cacheFileFor,
  parseGitHistory,
  mineHistory
};
