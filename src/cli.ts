#!/usr/bin/env tsx
import * as fs from 'node:fs';
import * as path from 'node:path';
import { mineHistory } from './git-history.js';
import { classifyHistory } from './signals.js';
import { generateCards, CARD_GENERATORS } from './cards.js';
import { why, formatWhy } from './why.js';

export type ParsedArgs = {
  help?: boolean;
  repo?: string;
  out?: string;
  minConfidence?: number;
  maxCards?: number;
  _: string[];
};

export function usage(): string {
  return `repo-arch

Usage:
  repo-arch mine-history [--repo <path>] [--out <file>]
  repo-arch mine [--repo <path>] [--out <file>]
  repo-arch classify [--repo <path>] [--out <file>]
  repo-arch cards [--repo <path>] [--out <file>] [--min-confidence <float>] [--max-cards <number>]
  repo-arch why <file-path> [--repo <path>]

Options:
  --repo   Path to a git repository (default: current directory)
  --out    Write output to a file instead of stdout
  --help   Show help
`;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }
    if (token === '--repo') {
      args.repo = argv[++i];
      continue;
    }
    if (token === '--out') {
      args.out = argv[++i];
      continue;
    }
    if (token === '--min-confidence') {
      args.minConfidence = parseFloat(argv[++i]);
      continue;
    }
    if (token === '--max-cards') {
      args.maxCards = parseInt(argv[++i], 10);
      continue;
    }
    args._.push(token);
  }
  return args;
}

export function main(argv: string[] = process.argv.slice(2)): { ok: boolean; help?: boolean; error?: string } {
  const args = parseArgs(argv);
  const command = args._[0];

  if (args.help || !command) {
    process.stdout.write(usage());
    return { ok: true, help: true };
  }

  if (command === 'mine-history' || command === 'mine') {
    const result = mineHistory({ repoPath: args.repo, outPath: args.out });
    if (!args.out) {
      process.stdout.write(result.jsonl);
    } else {
      process.stderr.write(`wrote ${result.count} commits to ${path.resolve(args.out)}${result.cacheHit ? ' (cache hit)' : ''}\n`);
    }
    return { ok: true };
  }

  if (command === 'classify' || command === 'signals') {
    const history = mineHistory({ repoPath: args.repo });
    const classified = classifyHistory(history.records);
    const jsonl = classified.map(c => JSON.stringify(c)).join('\n') + (classified.length ? '\n' : '');
    if (!args.out) {
      process.stdout.write(jsonl);
    } else {
      fs.writeFileSync(args.out, jsonl, 'utf8');
      process.stderr.write(`wrote ${classified.length} classified commits to ${path.resolve(args.out)}\n`);
    }
    return { ok: true };
  }

  if (command === 'cards') {
    const history = mineHistory({ repoPath: args.repo });
    const classified = classifyHistory(history.records);
    const cards = generateCards(classified, {
      minConfidence: args.minConfidence,
      maxCards: args.maxCards,
    });
    const jsonl = cards.map(c => JSON.stringify(c)).join('\n') + (cards.length ? '\n' : '');
    if (!args.out) {
      // Pretty terminal summary
      process.stdout.write(`\n  Repo-Arch Cards for ${history.repoRoot}\n`);
      process.stdout.write(`  ${history.headSha.slice(0, 12)} | ${history.count} commits\n\n`);
      for (const card of cards) {
        const icon = card.type === 'churn-hotspot' ? '\u26A1' : card.type === 'repeated-fix' ? '\u274C' : card.type === 'revert-pattern' ? '\u21A9' : card.type === 'test-gap' ? '\u26A0' : card.type === 'rationale-cluster' ? '\uD83D\uDCA1' : '\uD83D\uDD17';
        process.stdout.write(`  ${icon} ${card.title}\n`);
        process.stdout.write(`     Confidence: ${card.confidence} | ${card.supportingCommits.length} commits\n`);
        process.stdout.write(`     ${card.suggestion}\n\n`);
      }
    } else {
      fs.writeFileSync(path.resolve(args.out), jsonl, 'utf8');
      process.stderr.write(`wrote ${cards.length} cards to ${path.resolve(args.out)}\n`);
    }
    return { ok: true };
  }

  if (command === 'why') {
    const filePath = args._[1];
    if (!filePath) {
      process.stderr.write(`Error: missing file path\n\nUsage: repo-arch why <file-path> [--repo <path>]\n`);
      process.exitCode = 1;
      return { ok: false, error: 'Missing file path' };
    }
    const result = why(filePath, { repoPath: args.repo });
    const output = formatWhy(result);
    if (!args.out) {
      process.stdout.write(output);
    } else {
      fs.writeFileSync(path.resolve(args.out), output, 'utf8');
      process.stderr.write(`wrote explanation to ${path.resolve(args.out)}\n`);
    }
    return { ok: true };
  }

  process.stderr.write(`Unknown command: ${command}\n\n${usage()}`);
  process.exitCode = 1;
  return { ok: false, error: `Unknown command: ${command}` };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
