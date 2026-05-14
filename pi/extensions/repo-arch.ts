import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

const COMMANDS = [
  { label: 'Initialize config', command: 'repo-arch init', hint: 'write repo-arch.config.json' },
  { label: 'Run full flow', command: 'repo-arch flow run --full', hint: 'history → cards → dataset → embeddings → eval' },
  { label: 'Inspect latest run', command: 'repo-arch flow inspect latest', hint: 'show artifacts and next steps' },
  { label: 'Review cards', command: 'repo-arch review list', hint: 'accept/reject before training' },
  { label: 'Train adapter', command: 'repo-arch train --run', hint: 'prepare and run LoRA' },
  { label: 'Explain a file', command: 'repo-arch why src/core.ts --json', hint: 'history for one file' },
  { label: 'Find similar history', command: 'repo-arch similar "why auth middleware token-only?" --json', hint: 'semantic search over cards' },
];

function findConfigFile(cwd: string): string | null {
  const candidates = [
    path.join(cwd, 'repo-arch.config.json'),
    path.join(cwd, '.repo-arch', 'config.json'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export default function repoArchExtension(pi: ExtensionAPI) {
  pi.registerCommand('repo-arch', {
    description: 'Show the self-contained repo-arch CLI workflow',
    getArgumentCompletions: (prefix) => {
      const options = ['init', 'flow', 'review', 'train', 'eval', 'why', 'similar'];
      const filtered = options.filter((option) => option.startsWith(prefix));
      return filtered.length > 0 ? filtered.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      const cwd = process.cwd();
      const configFile = findConfigFile(cwd);
      const flowRun = configFile ? `repo-arch flow run --config ${path.relative(cwd, configFile)} --full` : 'repo-arch flow run --full';
      const choices = COMMANDS.map((entry) => {
        if (entry.command === 'repo-arch flow run --full') {
          return `${entry.label} — ${flowRun} — ${entry.hint}`;
        }
        return `${entry.label} — ${entry.command} — ${entry.hint}`;
      });

      const selected = await ctx.ui.select('repo-arch workflow', choices);
      if (!selected) return;

      const chosen = choices.find((choice) => choice === selected);
      if (chosen) {
        const command = chosen.includes('repo-arch flow run --full') ? flowRun : chosen.split(' — ')[1] ?? chosen;
        ctx.ui.notify(command, 'info');
      }
    },
  });
}
