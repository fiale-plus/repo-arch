#!/usr/bin/env tsx
import * as fs from 'node:fs';
import * as path from 'node:path';
import { mineHistory } from './git-history.js';
import { classifyHistory } from './signals.js';
import { generateCards, CARD_GENERATORS } from './cards.js';
import { why, formatWhy } from './why.js';
import { checkDiff, formatCheckDiff } from './check-diff.js';
import { resolveRepoRoot, getHeadSha } from './git-history.js';
import { cachedOrGenerate, invalidateCache } from './cache.js';
import { setCardStatus, listReviewState, getStatusOverrideMap, type ReviewMap } from './review.js';
import { whyContextPack, diffContextPack, cardsContextPack } from './context-pack.js';

export type ParsedArgs = {
  help?: boolean;
  json?: boolean;
  repo?: string;
  out?: string;
  base?: string;
  head?: string;
  minConfidence?: number;
  maxCards?: number;
  noCache?: boolean;
  invalidate?: boolean;
  _: string[];
};

export function usage(): string {
  return `repo-arch

Usage:
  repo-arch mine-history [--repo <path>] [--out <file>]
  repo-arch mine [--repo <path>] [--out <file>]
  repo-arch classify [--repo <path>] [--out <file>]
  repo-arch cards [--repo <path>] [--out <file>] [--min-confidence <float>] [--max-cards <number>]
  repo-arch why <file-path> [--repo <path>] [--json]
  repo-arch check-diff [--repo <path>] [--base <ref>] [--head <ref>] [--json]
  repo-arch accept <card-id> [--repo <path>]
  repo-arch reject <card-id> [--repo <path>]
  repo-arch review list [--repo <path>]
  repo-arch cards --invalidate
  repo-arch invalidate-cache [--repo <path>]

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
    if (token === '--base') {
      args.base = argv[++i];
      continue;
    }
    if (token === '--head') {
      args.head = argv[++i];
      continue;
    }
    if (token === '--no-cache') {
      args.noCache = true;
      continue;
    }
    if (token === '--invalidate') {
      args.invalidate = true;
      continue;
    }
    if (token === '--json') {
      args.json = true;
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
    const repoRoot = resolveRepoRoot(args.repo);

    // Invalidate mode
    if (args.invalidate) {
      const removed = invalidateCache(repoRoot);
      process.stderr.write(`removed ${removed} cached card file${removed !== 1 ? 's' : ''}\n`);
      return { ok: true };
    }

    const generateFn = () => {
      const history = mineHistory({ repoPath: args.repo });
      const classified = classifyHistory(history.records);
      return generateCards(classified, {
        minConfidence: args.minConfidence,
        maxCards: args.maxCards,
      }, getStatusOverrideMap(repoRoot));
    };

    let cards: import('./cards.js').InsightCard[];
    let cacheHit = false;
    let headSha = '';

    if (args.noCache) {
      cards = generateFn();
      headSha = getHeadSha(repoRoot);
    } else {
      const result = cachedOrGenerate(repoRoot, generateFn);
      cards = result.cards;
      cacheHit = result.cacheHit;
      headSha = result.headSha;
    }

    const jsonl = cards.map(c => JSON.stringify(c)).join('\n') + (cards.length ? '\n' : '');
    if (args.json) {
      const pack = cardsContextPack('all cards', cards, headSha, cacheHit);
      process.stdout.write(JSON.stringify(pack, null, 2) + '\n');
    } else if (!args.out) {
      process.stdout.write(`\n  Repo-Arch Cards for ${repoRoot}\n`);
      process.stdout.write(`  ${headSha.slice(0, 12)}${cacheHit ? ' (cached)' : ''} | ${cards.length} cards\n\n`);
      for (const card of cards) {
        const icon = card.type === 'churn-hotspot' ? '\u26A1' : card.type === 'repeated-fix' ? '\u274C' : card.type === 'revert-pattern' ? '\u21A9' : card.type === 'test-gap' ? '\u26A0' : card.type === 'rationale-cluster' ? '\uD83D\uDCA1' : '\uD83D\uDD17';
        const statusTag = card.status === 'accepted' ? ' ✅' : card.status === 'rejected' ? ' [rejected]' : '';
        process.stdout.write(`  ${icon} ${card.title}${statusTag}\n`);
        process.stdout.write(`     [${card.id.slice(0, 10)}] Confidence: ${card.confidence} | ${card.supportingCommits.length} commits\n`);
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
    if (args.json) {
      const pack = whyContextPack(filePath, result.relatedCards, result.commitCount, result.signalSummary, []);
      process.stdout.write(JSON.stringify(pack, null, 2) + '\n');
    } else {
      const output = formatWhy(result);
      if (!args.out) {
        process.stdout.write(output);
      } else {
        fs.writeFileSync(path.resolve(args.out), output, 'utf8');
        process.stderr.write(`wrote explanation to ${path.resolve(args.out)}\n`);
      }
    }
    return { ok: true };
  }

  if (command === 'check-diff' || command === 'diff') {
    const result = checkDiff({ repoPath: args.repo, base: args.base, head: args.head });
    if (args.json) {
      const pack = diffContextPack(args.base ?? 'HEAD~1', args.head ?? 'HEAD', result.changedFiles, result.warnings);
      process.stdout.write(JSON.stringify(pack, null, 2) + '\n');
    } else {
      const output = formatCheckDiff(result);
      if (!args.out) {
        process.stdout.write(output);
      } else {
        fs.writeFileSync(path.resolve(args.out), output, 'utf8');
        process.stderr.write(`wrote diff check to ${path.resolve(args.out)}\n`);
      }
    }
    return { ok: true };
  }

  if (command === 'invalidate-cache') {
    const repoRoot = resolveRepoRoot(args.repo);
    const removed = invalidateCache(repoRoot);
    process.stderr.write(`removed ${removed} cached card file${removed !== 1 ? 's' : ''}\n`);
    return { ok: true };
  }

  if (command === 'accept') {
    const cardId = args._[1];
    if (!cardId) {
      process.stderr.write('Error: missing card-id\n');
      process.exitCode = 1;
      return { ok: false, error: 'Missing card-id' };
    }
    const repoRoot = resolveRepoRoot(args.repo);
    const entry = setCardStatus(repoRoot, cardId, 'accepted');
    process.stderr.write(`accepted card ${cardId} at ${entry?.updatedAt}\n`);
    return { ok: true };
  }

  if (command === 'reject') {
    const cardId = args._[1];
    if (!cardId) {
      process.stderr.write('Error: missing card-id\n');
      process.exitCode = 1;
      return { ok: false, error: 'Missing card-id' };
    }
    const repoRoot = resolveRepoRoot(args.repo);
    const entry = setCardStatus(repoRoot, cardId, 'rejected');
    process.stderr.write(`rejected card ${cardId} at ${entry?.updatedAt}\n`);
    return { ok: true };
  }

  if (command === 'review') {
    const sub = args._[1];
    if (sub === 'list') {
      const repoRoot = resolveRepoRoot(args.repo);
      const state = listReviewState(repoRoot);
      const entries = Object.entries(state);
      if (entries.length === 0) {
        process.stdout.write('  No reviewed cards.\n');
      } else {
        process.stdout.write(`  Review state (${entries.length} cards)\n\n`);
        for (const [id, entry] of entries) {
          process.stdout.write(`  [${id.slice(0, 10)}] ${entry.status}  ${entry.updatedAt.slice(0, 10)}\n`);
        }
      }
    } else {
      process.stderr.write(`Usage: repo-arch review list\n`);
      process.exitCode = 1;
      return { ok: false, error: 'Expected subcommand: list' };
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
