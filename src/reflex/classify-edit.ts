/**
 * reflex classify-edit — detect risky file edits.
 *
 * Uses diff path + fragile-file scoring from repo-arch history.
 * Needs access to repo's history cache / signals for scoring.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export type FragileSignal = {
  type: 'repeated-fix' | 'co-change' | 'high-churn' | 'no-test' | 'generated' | 'config' | 'lockfile';
  confidence: number;
  description: string;
};

export type EditDecision = {
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  reason: string;
  signals: FragileSignal[];
  testRecommendations: string[];
  warnings: string[];
};

// Known risky file patterns
const CRITICAL_PATTERNS = [
  /\.lock$/,
  /^package-lock\.json$/,
  /\.generated\.ts$/i,
  /\.generated\.tsx$/i,
  /models\.generated\.ts$/,
  /node_modules\/.*\.json$/,
  /\.env$/,
  /\.env\.local$/,
  /\.env\.production$/,
];

const HIGH_RISK_PATTERNS = [
  /\.config\.(js|ts|mjs|cts)$/,
  /tsconfig.*\.json$/,
  /webpack\.config\./,
  /vite\.config\./,
  /next\.config\./,
  /jest\.config\./,
  /\.eslintrc/,
  /\.prettierrc/,
  /Dockerfile$/,
  /docker-compose\.ya?ml$/,
  /\.github\/workflows\//,
  /\.gitlab-ci\.ya?ml$/,
  /Makefile$/,
  /\.sh$/,
];

const MEDIUM_RISK_PATTERNS = [
  /\.test\.ts$/,
  /\.spec\.ts$/,
  /__tests__\//,
  /test\//,
  /tests\//,
  /src\/index\.ts$/,
  /src\/main\.ts$/,
  /src\/cli\.ts$/,
];

const GENERATED_PATTERNS = [
  /generated\.ts$/i,
  /\.gen\.ts$/i,
  /__generated__\//,
  /\/dist\//,
  /\/build\//,
];

const CONFIG_PATTERNS = [
  /package\.json$/,
  /\.config\./,
  /\.env/,
  /tsconfig/,
  /webpack\.config/,
  /\.eslintrc/,
  /\.prettierrc/,
  /\.gitignore/,
  /\.gitattributes/,
];

const LOCKFILE_PATTERNS = [
  /\.lock$/,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /bun\.lock$/,
  /poetry\.lock$/,
  /Cargo\.lock$/,
  /Gemfile\.lock$/,
];

function matchPatternList(file: string, patterns: RegExp[]): boolean {
  for (const p of patterns) {
    if (p.test(file)) return true;
  }
  return false;
}

/**
 * Load fragile-file scoring from repo-arch cache.
 * Returns a map of file -> score (0-1) where higher = more fragile.
 */
export function loadFragileMap(repoDir: string): Map<string, number> {
  const fragile = new Map<string, number>();

  // Try to load from repo-arch cache
  const cacheDir = path.join(repoDir, '.repo-arch', 'cache');
  if (!fs.existsSync(cacheDir)) return fragile;

  try {
    // Look for cards JSON
    const cardFiles = fs.readdirSync(cacheDir).filter(f => f.endsWith('.json'));
    for (const cf of cardFiles) {
      const data = JSON.parse(fs.readFileSync(path.join(cacheDir, cf), 'utf8'));
      const cards: any[] = Array.isArray(data) ? data : data.cards || [];
      for (const card of cards) {
        const files: string[] = card.affectedFiles || card.files || [];
        const conf = card.confidence || 0;
        const type = card.type || '';
        for (const f of files) {
          const existing = fragile.get(f) || 0;
          // repeated-fix and co-change cards indicate fragility
          if (type === 'repeated-fix' || type === 'co-change') {
            fragile.set(f, Math.max(existing, conf));
          }
        }
      }
    }
  } catch {
    // ignore missing/invalid cache
  }

  return fragile;
}

/**
 * Classify a file edit as risky or safe.
 *
 * @param filePath - absolute or relative path being edited
 * @param repoDir  - repository root
 * @param fragileMap - optional pre-loaded fragile file scores
 */
export function classifyEdit(
  filePath: string,
  repoDir: string,
  fragileMap?: Map<string, number>
): EditDecision {
  const signals: FragileSignal[] = [];
  const warnings: string[] = [];
  const testRecommendations: string[] = [];

  const normalized = path.normalize(filePath);

  // 1. Pattern-based classification
  if (matchPatternList(normalized, CRITICAL_PATTERNS)) {
    signals.push({
      type: 'lockfile',
      confidence: 1.0,
      description: `${normalized} is a lockfile or critical generated file`,
    });
    warnings.push('Lockfiles and generated files may be overwritten by build tools');
    return {
      riskLevel: 'critical',
      reason: 'critical file type (lockfile / generated / env)',
      signals,
      testRecommendations: [],
      warnings,
    };
  }

  if (matchPatternList(normalized, HIGH_RISK_PATTERNS)) {
    signals.push({
      type: 'config',
      confidence: 0.9,
      description: `${normalized} is a config file`,
    });
    warnings.push('Config files affect project behavior globally');
  }

  if (matchPatternList(normalized, MEDIUM_RISK_PATTERNS)) {
    testRecommendations.push('Ensure existing tests still pass after this change');
  }

  if (matchPatternList(normalized, GENERATED_PATTERNS)) {
    signals.push({
      type: 'generated',
      confidence: 1.0,
      description: `${normalized} appears to be a generated file`,
    });
    warnings.push('Generated files should not be manually edited — edit source instead');
  }

  if (matchPatternList(normalized, LOCKFILE_PATTERNS)) {
    signals.push({
      type: 'lockfile',
      confidence: 0.95,
      description: `${normalized} is a lockfile`,
    });
  }

  // 2. Repo-arch fragile map scoring
  const fm = fragileMap || loadFragileMap(repoDir);
  const fragileScore = fm.get(normalized) || fm.get(path.basename(normalized)) || 0;

  if (fragileScore >= 0.8) {
    signals.push({
      type: 'repeated-fix',
      confidence: fragileScore,
      description: `High fragile score from repo history: ${Math.round(fragileScore * 100)}% confidence`,
    });
    testRecommendations.push('This file has been fixed many times — consider adding regression tests');
  } else if (fragileScore >= 0.5) {
    signals.push({
      type: 'high-churn',
      confidence: fragileScore,
      description: `Elevated fragile score: ${Math.round(fragileScore * 100)}%`,
    });
  }

  // 3. Key filenames heuristics
  const basename = path.basename(normalized);
  if (/^agent-session/i.test(basename) || /^models\.generated/i.test(basename)) {
    signals.push({
      type: 'repeated-fix',
      confidence: 0.95,
      description: `${basename} is historically a high-churn file in pi`,
    });
    warnings.push(`${basename} has been modified many times without test coverage`);
    testRecommendations.push(`Run tests for ${path.dirname(normalized)} after changes`);
  }

  // 4. Determine overall risk
  const maxConfidence = signals.reduce((m, s) => Math.max(m, s.confidence), 0);
  let riskLevel: EditDecision['riskLevel'] = 'low';

  if (signals.some(s => s.confidence >= 1.0)) riskLevel = 'critical';
  else if (maxConfidence >= 0.8) riskLevel = 'high';
  else if (maxConfidence >= 0.5) riskLevel = 'medium';

  const reason = signals.length > 0
    ? `${signals.length} signal(s): ${signals.map(s => s.type).join(', ')}`
    : 'no high-risk signals detected';

  return {
    riskLevel,
    reason,
    signals,
    testRecommendations,
    warnings,
  };
}

export function formatEditDecision(decision: EditDecision, filePath: string): string {
  const risk = decision.riskLevel.toUpperCase();
  const lines = [
    `[${risk}] ${filePath}`,
    `  reason: ${decision.reason}`,
  ];
  if (decision.signals.length > 0) {
    lines.push(`  signals: ${decision.signals.map(s => `${s.type}(${s.confidence})`).join(', ')}`);
  }
  if (decision.warnings.length > 0) {
    lines.push(`  warnings: ${decision.warnings.join(' | ')}`);
  }
  if (decision.testRecommendations.length > 0) {
    lines.push(`  tests: ${decision.testRecommendations.join(' | ')}`);
  }
  return lines.join('\n');
}