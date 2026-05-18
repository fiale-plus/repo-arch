/**
 * reflex test-plan — recommend tests/checks based on changed files.
 *
 * Uses co-change history + fragile file scoring + related test discovery.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export type RecommendedTest = {
  path: string;
  reason: string;
  confidence: number;
  type: 'unit' | 'integration' | 'e2e' | 'lint' | 'typecheck';
};

export type TestPlan = {
  targetFile: string;
  recommendations: RecommendedTest[];
  warnings: string[];
  skipRecommendations: string[];
};

/**
 * Discover test files for a given source file.
 */
function discoverTests(filePath: string, repoDir: string): string[] {
  const tests: string[] = [];
  const dir = path.dirname(filePath);
  const basename = path.basename(filePath, path.extname(filePath));

  // Same-dir patterns
  const sameDir = [
    path.join(dir, `${basename}.test.ts`),
    path.join(dir, `${basename}.spec.ts`),
    path.join(dir, `${basename}.test.js`),
    path.join(dir, `${basename}.spec.js`),
    path.join(dir, `${basename}.test.tsx`),
    path.join(dir, `${basename}.spec.tsx`),
  ];

  for (const t of sameDir) {
    if (fs.existsSync(t)) tests.push(t);
  }

  // __tests__ dir
  const testDir = path.join(dir, '__tests__', `${basename}.ts`);
  if (fs.existsSync(testDir)) tests.push(testDir);

  // test/ sibling dir
  const testDir2 = path.join(dir, 'test', `${basename}.ts`);
  const testDir3 = path.join(dir, 'tests', `${basename}.ts`);
  if (fs.existsSync(testDir2)) tests.push(testDir2);
  if (fs.existsSync(testDir3)) tests.push(testDir3);

  // tests/ dir at repo root
  const rootTests = path.join(repoDir, 'tests', basename + '.ts');
  if (fs.existsSync(rootTests)) tests.push(rootTests);

  return [...new Set(tests)];
}

/**
 * Find files that co-change with the target file (from repo-arch cache).
 */
function findCoChanged(targetFile: string, repoDir: string): string[] {
  const cochanged: string[] = [];

  const cacheDir = path.join(repoDir, '.repo-arch', 'cache');
  if (!fs.existsSync(cacheDir)) return [];

  try {
    const cardFiles = fs.readdirSync(cacheDir).filter(f => f.endsWith('.json'));
    for (const cf of cardFiles) {
      const data = JSON.parse(fs.readFileSync(path.join(cacheDir, cf), 'utf8'));
      const cards: any[] = Array.isArray(data) ? data : data.cards || [];
      for (const card of cards) {
        if (card.type === 'co-change') {
          const files: string[] = card.affectedFiles || card.files || [];
          if (files.some(f => f.includes(targetFile) || targetFile.includes(f))) {
            cochanged.push(...files.filter(f => f !== targetFile));
          }
        }
      }
    }
  } catch {
    // ignore
  }

  return [...new Set(cochanged)];
}

/**
 * Generate a test plan for a changed file.
 */
export function generateTestPlan(filePath: string, repoDir: string): TestPlan {
  const recommendations: RecommendedTest[] = [];
  const warnings: string[] = [];
  const skipRecommendations: string[] = [];

  const normalized = path.normalize(filePath);
  const ext = path.extname(normalized);

  // 1. Discover direct tests
  const directTests = discoverTests(normalized, repoDir);
  for (const t of directTests) {
    recommendations.push({
      path: t,
      reason: 'direct test file for this source',
      confidence: 0.95,
      type: 'unit',
    });
  }

  // 2. Check if file has no tests (test gap)
  if (directTests.length === 0) {
    warnings.push(`${normalized} has no discoverable test file`);
    skipRecommendations.push('Consider adding a test before this change');
  }

  // 3. Find co-changed files
  const coChanged = findCoChanged(normalized, repoDir);
  for (const f of coChanged) {
    const testsForCochanged = discoverTests(f, repoDir);
    for (const t of testsForCochanged) {
      if (!recommendations.some(r => r.path === t)) {
        recommendations.push({
          path: t,
          reason: `co-changed with ${path.basename(normalized)}: ${path.basename(f)}`,
          confidence: 0.7,
          type: 'unit',
        });
      }
    }
  }

  // 4. Language-specific checks
  const exts = new Set([ext]);

  // TypeScript: typecheck
  if (ext === '.ts' || ext === '.tsx') {
    // Check if there's a tsconfig
    const tsconfig = path.join(repoDir, 'tsconfig.json');
    if (fs.existsSync(tsconfig)) {
      recommendations.push({
        path: 'tsc --noEmit',
        reason: 'TypeScript type check',
        confidence: 0.9,
        type: 'typecheck',
      });
    }
  }

  // 5. Package-level checks
  const pkg = path.join(repoDir, 'package.json');
  const pkgJson = fs.existsSync(pkg) ? JSON.parse(fs.readFileSync(pkg, 'utf8')) : {};
  const scripts: Record<string, string> = pkgJson.scripts || {};

  const pkgDir = path.dirname(normalized);
  const srcDir = path.join(repoDir, 'src');

  if (normalized.includes('/packages/') || normalized.includes('/apps/')) {
    // Monorepo workspace — suggest workspace test
    const wsName = normalized.split('/')[2];
    if (scripts[`test:${wsName}`]) {
      recommendations.push({
        path: `npm run test:${wsName}`,
        reason: `monorepo workspace test for ${wsName}`,
        confidence: 0.85,
        type: 'unit',
      });
    }
  }

  // 6. E2E / integration hints
  if (normalized.includes('/src/') && !normalized.includes('/test')) {
    // Look for e2e test dirs
    const e2eDirs = ['e2e', 'tests/e2e', 'cypress', '__e2e__'];
    for (const e2e of e2eDirs) {
      const e2ePath = path.join(repoDir, e2e);
      if (fs.existsSync(e2ePath)) {
        recommendations.push({
          path: e2ePath,
          reason: 'e2e test directory exists — consider running if change is user-facing',
          confidence: 0.5,
          type: 'e2e',
        });
      }
    }
  }

  return {
    targetFile: normalized,
    recommendations: recommendations.slice(0, 8), // cap at 8
    warnings,
    skipRecommendations,
  };
}

export function formatTestPlan(plan: TestPlan): string {
  const lines = [`Test plan for: ${plan.targetFile}`, ''];

  if (plan.warnings.length > 0) {
    lines.push(`⚠️  ${plan.warnings.join('\n⚠️  ')}`, '');
  }

  if (plan.recommendations.length === 0) {
    lines.push('No test recommendations.');
    return lines.join('\n');
  }

  lines.push('Recommended checks:');
  for (const r of plan.recommendations) {
    const conf = Math.round(r.confidence * 100);
    lines.push(`  [${r.type}] ${r.path} (${conf}% confidence) — ${r.reason}`);
  }

  if (plan.skipRecommendations.length > 0) {
    lines.push('');
    lines.push(`Consider: ${plan.skipRecommendations.join(' | ')}`);
  }

  return lines.join('\n');
}