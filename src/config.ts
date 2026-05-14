import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveRepoRoot } from './git-history.js';
import { DEFAULT_MODEL as DEFAULT_EMBEDDING_MODEL } from './embedder.js';

export const DEFAULT_CONFIG_FILE = 'repo-arch.config.json';
export const DEFAULT_RUNS_DIR = '.repo-arch/runs';
export const DEFAULT_TRAINING_MODEL = 'Qwen/Qwen2.5-Coder-1.5B-Instruct';
export const DEFAULT_TRAINING_ITERS = 100;
export const DEFAULT_TRAINING_LEARNING_RATE = 1e-5;

export type RepoArchConfigFile = {
  schemaVersion: 1;
  flow?: {
    runsDir?: string;
  };
  cards?: {
    minConfidence?: number;
    maxCards?: number;
  };
  index?: {
    model?: string;
  };
  training?: {
    model?: string;
    iters?: number;
    learningRate?: number;
    run?: boolean;
    includeRejected?: boolean;
  };
};

export type ResolvedRepoArchConfig = {
  repoRoot: string;
  configPath: string | null;
  raw: RepoArchConfigFile;
  flow: {
    runsDir: string;
  };
  cards: {
    minConfidence: number;
    maxCards: number;
  };
  index: {
    model: string;
  };
  training: {
    model: string;
    iters: number;
    learningRate: number;
    run: boolean;
    includeRejected: boolean;
  };
};

export function defaultConfigFile(): RepoArchConfigFile {
  return {
    schemaVersion: 1,
    flow: {
      runsDir: DEFAULT_RUNS_DIR,
    },
    cards: {
      minConfidence: 0.3,
      maxCards: 20,
    },
    index: {
      model: DEFAULT_EMBEDDING_MODEL,
    },
    training: {
      model: DEFAULT_TRAINING_MODEL,
      iters: DEFAULT_TRAINING_ITERS,
      learningRate: DEFAULT_TRAINING_LEARNING_RATE,
      run: false,
      includeRejected: false,
    },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJsonFile(filePath: string): RepoArchConfigFile {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  if (!isObject(parsed)) {
    throw new Error(`Invalid config file: ${filePath}`);
  }
  return parsed as RepoArchConfigFile;
}

function resolveMaybeRelative(baseDir: string, value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(baseDir, value);
}

function mergeConfig(overrides: RepoArchConfigFile | undefined): RepoArchConfigFile {
  const base = defaultConfigFile();
  return {
    schemaVersion: 1,
    flow: {
      ...base.flow,
      ...overrides?.flow,
    },
    cards: {
      ...base.cards,
      ...overrides?.cards,
    },
    index: {
      ...base.index,
      ...overrides?.index,
    },
    training: {
      ...base.training,
      ...overrides?.training,
    },
  };
}

export function findConfigPath(repoRoot: string, explicitPath?: string): string | null {
  if (explicitPath) {
    const resolved = path.isAbsolute(explicitPath) ? explicitPath : path.resolve(repoRoot, explicitPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Config file not found: ${resolved}`);
    }
    return resolved;
  }

  const candidates = [
    path.join(repoRoot, DEFAULT_CONFIG_FILE),
    path.join(repoRoot, '.repo-arch', 'config.json'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

export function loadRepoArchConfig(options: { repoPath?: string; configPath?: string } = {}): ResolvedRepoArchConfig {
  const repoRoot = resolveRepoRoot(options.repoPath);
  const configPath = findConfigPath(repoRoot, options.configPath);
  const raw = configPath ? readJsonFile(configPath) : defaultConfigFile();
  const merged = mergeConfig(raw);
  const configBase = configPath ? path.dirname(configPath) : repoRoot;

  return {
    repoRoot,
    configPath,
    raw,
    flow: {
      runsDir: resolveMaybeRelative(configBase, merged.flow?.runsDir ?? DEFAULT_RUNS_DIR),
    },
    cards: {
      minConfidence: merged.cards?.minConfidence ?? 0.3,
      maxCards: merged.cards?.maxCards ?? 20,
    },
    index: {
      model: merged.index?.model ?? DEFAULT_EMBEDDING_MODEL,
    },
    training: {
      model: merged.training?.model ?? DEFAULT_TRAINING_MODEL,
      iters: merged.training?.iters ?? DEFAULT_TRAINING_ITERS,
      learningRate: merged.training?.learningRate ?? DEFAULT_TRAINING_LEARNING_RATE,
      run: merged.training?.run ?? false,
      includeRejected: merged.training?.includeRejected ?? false,
    },
  };
}

export function writeRepoArchConfigTemplate(outPath: string): RepoArchConfigFile {
  const config = defaultConfigFile();
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  return config;
}

export function configSummary(config: ResolvedRepoArchConfig): string {
  return [
    `config: ${config.configPath ?? '(defaults)'}`,
    `runsDir: ${config.flow.runsDir}`,
    `cards: minConfidence=${config.cards.minConfidence}, maxCards=${config.cards.maxCards}`,
    `index: ${config.index.model}`,
    `training: ${config.training.model} / iters=${config.training.iters} / lr=${config.training.learningRate}`,
  ].join('\n');
}
