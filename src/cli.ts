#!/usr/bin/env node
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
import { checkStaleness, formatStaleness } from './staleness.js';
import { similar } from './similar.js';
import { buildIndex, loadIndex } from './embedder.js';
import { runEval, formatEval } from './eval.js';
import { generateDataset, formatDataset, prepareTrain, formatTrain } from './training.js';
import { loadRepoArchConfig, writeRepoArchConfigTemplate, DEFAULT_CONFIG_FILE } from './config.js';
import { runFlow, inspectFlow, formatFlowRun, formatFlowInspect } from './flow.js';

export type ParsedArgs = {
  help?: boolean;
  json?: boolean;
  repo?: string;
  out?: string;
  base?: string;
  head?: string;
  model?: string;
  iters?: number;
  learningRate?: number;
  minConfidence?: number;
  maxCards?: number;
  noCache?: boolean;
  invalidate?: boolean;
  config?: string;
  includeRejected?: boolean;
  _: string[];
};

export function helpFor(command: string): string | null {
  const cmds: Record<string, string> = {
    'mine-history': `repo-arch mine-history --repo <path>

  Mine all git history from a repository and cache it locally.

  Example:
    repo-arch mine-history --repo . --out history.jsonl

  Next: repo-arch classify`,
    'classify': `repo-arch classify --repo <path>

  Classify commit signals (fix, revert, docs, test, etc.) against known patterns.

  Example:
    repo-arch classify --repo .

  Next: repo-arch cards`,
    'cards': `repo-arch cards --repo <path> [--invalidate] [--min-confidence <n>] [--max-cards <n>]

  Generate insight cards from classified history. Cards are cached by HEAD.

  Examples:
    repo-arch cards --repo .
    repo-arch cards --invalidate --repo .

  Next: repo-arch review list`,
    'init': `repo-arch init [--out repo-arch.config.json]

  Write a starter config that keeps the flow self-contained.

  Example:
    repo-arch init --out repo-arch.config.json`,
    'accept': `repo-arch accept <card-id> --repo <path>

  Mark a card as accepted. Accepted cards are used in eval and training.

  Example:
    repo-arch accept abc123def456 --repo .

  Next: repo-arch eval`,
    'reject': `repo-arch reject <card-id> --repo <path>

  Mark a card as rejected (noisy / not useful).

  Example:
    repo-arch reject abc123def456 --repo .`,
    'review': `repo-arch review list --repo <path>

  Show all accepted/rejected card statuses.

  Example:
    repo-arch review list --repo .

  Next: repo-arch eval`,
    'why': `repo-arch why <file-path> --repo <path> [--json]

  Explain a file's history: fix count, signals, co-change partners.

  Example:
    repo-arch why src/core.ts --json`,
    'check-diff': `repo-arch check-diff --repo <path> [--base <ref>] [--head <ref>] [--json]

  Check a diff for regression warnings based on card history.

  Example:
    repo-arch check-diff --base main --json`,
    'check-stale': `repo-arch check-stale --repo <path> [--json]

  Check whether existing cards are still accurate (files may have moved or been deleted).`,
    'index': `repo-arch index --repo <path>

  Build an embedding index from cards for similarity search.

  Example:
    repo-arch index --repo .`,
    'similar': `repo-arch similar <query> --repo <path> [--json]

  Search past cards by semantic similarity.

  Example:
    repo-arch similar "why auth middleware token-only?" --json`,
    'eval': `repo-arch eval --repo <path> [--json]

  Run retrieval benchmarks against accepted cards.

  Requires: at least one accepted card`,
    'dataset': `repo-arch dataset --repo <path> [--out <file>] [--json]

  Generate training dataset from accepted cards.

  Example:
    repo-arch dataset --repo .`,
    'train': `repo-arch train <prepare|run> --repo <path> [--config <file>] [--out <dir>] [--model <name>] [--iters <n>] [--learning-rate <n>]

  Prepare or execute LoRA training.

  Example:
    repo-arch train prepare --repo .
    repo-arch train run --repo .`,
    'flow': `repo-arch flow run [prepare|full] --repo <path> [--config repo-arch.config.json]

  Orchestrate the end-to-end flow: history -> cards -> dataset -> train plan -> embeddings/eval.

  Examples:
    repo-arch flow run --repo .
    repo-arch flow run full --repo .
    repo-arch flow inspect --repo .`,
  };
  const aliases: Record<string, string> = {
    'mine': 'mine-history',
    'signals': 'classify',
    'diff': 'check-diff',
    'stale': 'check-stale',
    'invalidate-cache': '',
    'benchmark': 'eval',
    'train-data': 'dataset',
    'tutorial': '',
  };
  const resolved = aliases[command] ?? command;
  if (resolved === '') return null;
  return cmds[resolved] ?? null;
}

export function tutorial(): string {
  return `repo-arch tutorial — Guided onboarding

  repo-arch turns git history into a repeatable flow: cards, retrieval, datasets, and training plans.

  ┌─ 1.  init  ─────────────────────────────────────────────┐
  │  Write a starter config for the full flow.              │
  │  repo-arch init                                         │
  └─────────────────────────────────────────────────────────┘

  ┌─ 2.  flow run  ─────────────────────────────────────────┐
  │  Generate a run bundle with history, cards, dataset,    │
  │  training plan, and optional embeddings/eval.           │
  │  repo-arch flow run full                                │
  └─────────────────────────────────────────────────────────┘

  ┌─ 3.  flow inspect  ─────────────────────────────────────┐
  │  Review the latest run and next steps.                  │
  │  repo-arch flow inspect                                 │
  └─────────────────────────────────────────────────────────┘

  ┌─ 4.  review / accept / reject  ─────────────────────────┐
  │  Curate which cards are useful. Accepted cards feed      │
  │  eval benchmarks and training datasets.                  │
  │  repo-arch review list --repo .                          │
  │  repo-arch accept <card-id> --repo .                     │
  └─────────────────────────────────────────────────────────┘

  ┌─ 5.  train  ────────────────────────────────────────────┐
  │  Prepare or run LoRA fine-tuning.                       │
  │  repo-arch train prepare|run                            │
  └─────────────────────────────────────────────────────────┘

  Additional tools:
    why <file>       — explain a file's history
    check-diff       — warn about regression risks in a diff
    check-stale      — detect cards pointing to removed files
    index + similar  — semantic search over past cards
`;
}

export function usage(): string {
  const workflow = `repo-arch — project-memory engine for git history

Recommended workflow:
  0. repo-arch init          — write a starter repo-arch.config.json
  1. repo-arch flow run      — generate artifacts for the current repo
  2. repo-arch flow inspect  — review the latest run and next steps
  3. repo-arch review list   — curate cards before training
  4. repo-arch eval          — run retrieval benchmarks
  5. repo-arch dataset       — export training examples
  6. repo-arch train prepare — write the training plan
  7. repo-arch train run     — execute LoRA fine-tuning

Commands:
  init            Write a starter repo-arch.config.json
  flow run        Generate run artifacts from history to training
  flow inspect    Inspect the latest or named run
  mine-history    Scan and cache all git history
  classify        Tag commits with signal types (fix, docs, etc.)
  cards           Generate insight cards from classified commits
  why <file>      Explain a file\'s commit history
  check-diff      Check a diff for regression warnings
  check-stale     Detect stale cards (pointing to missing files)
  index           Build embedding index for similar search
  similar <query> Semantic similarity search over cards
  accept|reject   Curate card quality
  review list     Show accepted/rejected card statuses
  eval            Benchmark card retrieval
  dataset         Export training examples from accepted cards
  train           Prepare and run LoRA fine-tuning

Global options:
  --repo <path>          Path to a git repository (default: current directory)
  --out <file|dir>       Write output to a file or flow run directory
  --config <file>        Load repo-arch.config.json from a custom path
  --json                 Output structured JSON
  --help                 Show help

Training options:
  --learning-rate <n>    Override the training learning rate

Learn more:
  repo-arch <command> --help   — command-specific help
  repo-arch tutorial            — guided onboarding walkthrough
`;
  return workflow;
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
    if (token === '--include-rejected') {
      args.includeRejected = true;
      continue;
    }
    if (token === '--config') {
      args.config = argv[++i];
      continue;
    }
    if (token === '--model') {
      args.model = argv[++i];
      continue;
    }
    if (token === '--iters') {
      args.iters = parseInt(argv[++i], 10);
      continue;
    }
    if (token === '--learning-rate') {
      args.learningRate = parseFloat(argv[++i]);
      continue;
    }
    args._.push(token);
  }
  return args;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<{ ok: boolean; help?: boolean; error?: string }> {
  const args = parseArgs(argv);
  const command = args._[0];

  if (args.help || !command) {
    // Show top-level help if no command, or per-command help if --help with a command
    if (!command) {
      process.stdout.write(usage());
      return { ok: true, help: true };
    }
    if (helpFor(command)) {
      process.stdout.write(helpFor(command) + '\n');
      return { ok: true, help: true };
    }
    process.stdout.write('Unknown command: ' + command + '\n\n' + usage());
    return { ok: true, help: true };
  }

  if (command === 'tutorial') {
    process.stdout.write(tutorial());
    return { ok: true };
  }

  if (command === 'init') {
    const repoRoot = resolveRepoRoot(args.repo);
    const outPath = args.out ? (path.isAbsolute(args.out) ? args.out : path.resolve(repoRoot, args.out)) : path.join(repoRoot, DEFAULT_CONFIG_FILE);
    writeRepoArchConfigTemplate(outPath);
    process.stdout.write(`wrote ${outPath}\n`);
    process.stdout.write(`next: repo-arch flow run --repo ${repoRoot} --config ${path.relative(repoRoot, outPath)}\n`);
    return { ok: true };
  }

  if (command === 'flow') {
    const sub = args._[1];
    if (sub === 'run') {
      const preset = args._[2] ?? 'prepare';
      if (preset !== 'prepare' && preset !== 'full') {
        process.stderr.write(`Usage: repo-arch flow run [prepare|full]\n`);
        process.exitCode = 1;
        return { ok: false, error: 'Expected preset: prepare|full' };
      }
      const result = await runFlow({
        repoPath: args.repo,
        configPath: args.config,
        outPath: args.out,
        full: preset === 'full',
        includeRejected: args.includeRejected,
        minConfidence: args.minConfidence,
        maxCards: args.maxCards,
        model: args.model,
        iters: args.iters,
        learningRate: args.learningRate,
      });
      if (args.json) {
        process.stdout.write(JSON.stringify(result.manifest, null, 2) + '\n');
      } else {
        process.stdout.write(formatFlowRun(result));
      }
      return { ok: true };
    }
    if (sub === 'inspect') {
      const runId = args._[2] ?? 'latest';
      const result = inspectFlow({ repoPath: args.repo, configPath: args.config, runId });
      if (args.json) {
        process.stdout.write(JSON.stringify(result.manifest, null, 2) + '\n');
      } else {
        process.stdout.write(formatFlowInspect(result));
      }
      return { ok: true };
    }
    process.stderr.write(`Usage: repo-arch flow run|inspect\n`);
    process.exitCode = 1;
    return { ok: false, error: 'Expected subcommand: run|inspect' };
  }

  if (command === 'help') {
    const sub = args._[1];
    if (sub && helpFor(sub)) {
      process.stdout.write(helpFor(sub) + '\n');
      return { ok: true };
    }
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

  if (command === 'check-stale' || command === 'stale') {
    const repoRoot = resolveRepoRoot(args.repo);
    const generateFn = () => {
      const history = mineHistory({ repoPath: args.repo });
      const classified = classifyHistory(history.records);
      return generateCards(classified, {}, getStatusOverrideMap(repoRoot));
    };
    const { cards } = cachedOrGenerate(repoRoot, generateFn);
    const summary = checkStaleness(cards, { repoPath: args.repo });
    if (args.json) {
      process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    } else {
      const output = formatStaleness(summary);
      if (!args.out) {
        process.stdout.write(output);
      } else {
        fs.writeFileSync(path.resolve(args.out), output, 'utf8');
        process.stderr.write(`wrote staleness check to ${path.resolve(args.out)}\n`);
      }
    }
    return { ok: true };
  }

  if (command === 'index') {
    const repoRoot = resolveRepoRoot(args.repo);
    const generateFn = () => {
      const history = mineHistory({ repoPath: args.repo });
      const classified = classifyHistory(history.records);
      return generateCards(classified, {}, getStatusOverrideMap(repoRoot));
    };
    const { cards } = cachedOrGenerate(repoRoot, generateFn);
    const entries = cards.map(card => ({
      id: card.id,
      text: `${card.title}. ${card.suggestion} ${card.supportingCommits.map(c => c.subject).join('. ')}`,
      source: 'card' as const,
      metadata: { type: card.type, confidence: String(card.confidence), status: card.status },
    }));
    const index = await buildIndex(entries, { repoPath: args.repo });
    process.stderr.write(`indexed ${index.entries.length} entries at ${index.headSha.slice(0, 12)}\n`);
    if (args.json) {
      process.stdout.write(JSON.stringify({ indexed: index.entries.length, headSha: index.headSha, model: index.model }, null, 2) + '\n');
    }
    return { ok: true };
  }

  if (command === 'similar') {
    const query = args._.slice(1).join(' ');
    if (!query) {
      process.stderr.write('Error: missing query\n');
      process.exitCode = 1;
      return { ok: false, error: 'Missing query' };
    }
    const result = await similar(query, { repoPath: args.repo, topK: args.maxCards ?? 5 });
    if (args.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
      process.stdout.write(`\n  Similar to: "${query}"\n`);
      process.stdout.write(`  Index: ${result.indexStats.entries} entries (${result.indexStats.model}) at ${result.indexStats.headSha}\n\n`);
      for (const r of result.results) {
        process.stdout.write(`  ${r.score.toFixed(3)}  ${r.text.slice(0, 100)}...\n`);
        process.stdout.write(`        [${r.id.slice(0, 10)}] ${r.metadata.type}\n\n`);
      }
    }
    return { ok: true };
  }

  if (command === 'eval' || command === 'benchmark') {
    const report = await runEval({ repoPath: args.repo });
    if (args.json) {
      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    } else {
      process.stdout.write(formatEval(report));
    }
    return { ok: true };
  }

  if (command === 'dataset' || command === 'train-data') {
    const config = args.config ? loadRepoArchConfig({ repoPath: args.repo, configPath: args.config }) : null;
    const result = generateDataset({ repoPath: args.repo, outPath: args.out, includeRejected: args.includeRejected ?? config?.training.includeRejected });
    if (args.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else if (!args.out) {
      process.stdout.write(formatDataset(result));
    }
    return { ok: true };
  }

  if (command === 'train') {
    const mode = args._[1] ?? 'prepare';
    if (mode !== 'prepare' && mode !== 'run') {
      process.stderr.write(`Usage: repo-arch train [prepare|run]\n`);
      process.exitCode = 1;
      return { ok: false, error: 'Expected mode: prepare|run' };
    }
    try {
      const config = args.config ? loadRepoArchConfig({ repoPath: args.repo, configPath: args.config }) : null;
      const plan = prepareTrain({
        repoPath: args.repo,
        outPath: args.out,
        model: args.model ?? config?.training.model,
        iters: args.iters ?? config?.training.iters,
        learningRate: args.learningRate ?? config?.training.learningRate,
        run: mode === 'run',
      });
      process.stdout.write(formatTrain(plan));
      if (mode === 'run') {
        const { execSync } = await import('node:child_process');
        process.stderr.write(`Running training...\n`);
        try {
          const cmd = plan.command.replace(/\\\n  /g, ' ');
          execSync(cmd, { stdio: 'inherit', cwd: resolveRepoRoot(args.repo) });
        } catch (e) {
          process.stderr.write(`Training failed. Install mlx-lm: pip install mlx-lm\n`);
          process.exitCode = 1;
        }
      }
    } catch (e) {
      process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
      process.exitCode = 1;
    }
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
