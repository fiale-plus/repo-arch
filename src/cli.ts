#!/usr/bin/env tsx
import * as path from 'node:path';
import { mineHistory } from './git-history.js';

export type ParsedArgs = {
  help?: boolean;
  repo?: string;
  out?: string;
  _: string[];
};

export function usage(): string {
  return `repo-arch

Usage:
  repo-arch mine-history [--repo <path>] [--out <file>]
  repo-arch mine [--repo <path>] [--out <file>]

Options:
  --repo   Path to a git repository (default: current directory)
  --out    Write JSONL output to a file instead of stdout
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
