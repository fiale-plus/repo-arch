#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { mineHistory } = require('./git-history');

function usage() {
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

function parseArgs(argv) {
  const args = { _: [] };
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

function main(argv = process.argv.slice(2)) {
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
    return { ok: true, ...result };
  }

  process.stderr.write(`Unknown command: ${command}\n\n${usage()}`);
  process.exitCode = 1;
  return { ok: false, error: `Unknown command: ${command}` };
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main, parseArgs, usage };
