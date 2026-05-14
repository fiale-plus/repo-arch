import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { inspectFlow, type FlowInspectResult } from './flow.js';
import { prepareTrain, findLatestAdapterCheckpoint, type TrainPlan } from './training.js';
import { loadRepoArchConfig } from './config.js';

export type TrainCycleSession = {
  schemaVersion: 1;
  sessionId: string;
  runId: string;
  runDir: string;
  flowManifestPath: string;
  createdAt: string;
  updatedAt: string;
  status: 'idle' | 'running' | 'ok' | 'failed';
  model: string;
  iters: number;
  learningRate: number;
  adapterPath: string;
  resumeAdapterFile: string | null;
  latestCheckpoint: string | null;
  command: string;
  trainPlan: string;
};

export type TrainCycleOptions = {
  repoPath?: string;
  configPath?: string;
  runRef?: string;
  model?: string;
  iters?: number;
  learningRate?: number;
};

export type TrainCycleResult = {
  flow: FlowInspectResult;
  plan: TrainPlan;
  session: TrainCycleSession;
  sessionPath: string;
  cyclesPath: string;
  resumeAdapterFile: string | null;
};

function now(): string {
  return new Date().toISOString();
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function appendJsonl(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(value) + '\n', 'utf8');
}

function sessionPath(runDir: string): string {
  return path.join(runDir, 'training', 'session.json');
}

function cyclesPath(runDir: string): string {
  return path.join(runDir, 'training', 'cycles.jsonl');
}

function createSession(flow: FlowInspectResult, plan: TrainPlan, resumeAdapterFile: string | null): TrainCycleSession {
  const sessionId = `${flow.manifest.run.id}-${plan.model.replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 24)}`;
  const startedAt = now();
  return {
    schemaVersion: 1,
    sessionId,
    runId: flow.manifest.run.id,
    runDir: flow.runDir,
    flowManifestPath: flow.manifestPath,
    createdAt: startedAt,
    updatedAt: startedAt,
    status: 'idle',
    model: plan.model,
    iters: plan.iters,
    learningRate: plan.learningRate,
    adapterPath: plan.adapterPath,
    resumeAdapterFile,
    latestCheckpoint: resumeAdapterFile,
    command: plan.command,
    trainPlan: path.join(flow.runDir, 'training', 'train-plan.json'),
  };
}

export function loadTrainSession(runDir: string): TrainCycleSession | null {
  const filePath = sessionPath(runDir);
  if (!fs.existsSync(filePath)) return null;
  try {
    return readJson<TrainCycleSession>(filePath);
  } catch {
    return null;
  }
}

export function listTrainSessions(repoPath?: string, configPath?: string): TrainCycleSession[] {
  const config = loadRepoArchConfig({ repoPath, configPath });
  const runsDir = config.flow.runsDir;
  if (!fs.existsSync(runsDir)) return [];
  const sessions: TrainCycleSession[] = [];
  for (const entry of fs.readdirSync(runsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(runsDir, entry.name, 'training', 'session.json');
    if (!fs.existsSync(candidate)) continue;
    const session = loadTrainSession(path.join(runsDir, entry.name));
    if (session) sessions.push(session);
  }
  return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function formatTrainCycleResult(result: TrainCycleResult): string {
  const lines: string[] = [];
  lines.push(`\n  Training cycle for ${result.flow.manifest.run.id}`);
  lines.push(`  Session: ${result.session.sessionId}`);
  lines.push(`  Run dir: ${result.flow.runDir}`);
  lines.push(`  Model: ${result.session.model}`);
  lines.push(`  Resume: ${result.resumeAdapterFile ?? '(fresh)'}`);
  lines.push(`  Checkpoint: ${result.session.latestCheckpoint ?? '(none yet)'}`);
  lines.push(`  Command:`);
  lines.push(`  ${result.plan.command.replace(/\\n/g, '\n')}`);
  lines.push('');
  return lines.join('\n');
}

export function formatTrainStatus(session: TrainCycleSession | null, flow?: FlowInspectResult): string {
  const lines: string[] = [];
  if (!session) {
    lines.push('\n  No training session found.');
    lines.push('  Use `repo-arch train cycle` first.\n');
    return lines.join('\n');
  }
  lines.push(`\n  Training session: ${session.sessionId}`);
  lines.push(`  Run: ${session.runId}`);
  lines.push(`  Status: ${session.status}`);
  lines.push(`  Model: ${session.model}`);
  lines.push(`  Resume: ${session.resumeAdapterFile ?? '(fresh)'}`);
  lines.push(`  Latest checkpoint: ${session.latestCheckpoint ?? '(none yet)'}`);
  lines.push(`  Updated: ${session.updatedAt}`);
  if (flow) {
    lines.push(`  Flow run dir: ${flow.runDir}`);
  }
  lines.push('');
  return lines.join('\n');
}

export function formatTrainList(sessions: TrainCycleSession[]): string {
  const lines: string[] = [];
  lines.push(`\n  Training sessions (${sessions.length})\n`);
  if (sessions.length === 0) {
    lines.push('  No sessions found.');
    lines.push('');
    return lines.join('\n');
  }
  for (const session of sessions) {
    lines.push(`  ${session.status.padEnd(6)} ${session.sessionId}  ${session.updatedAt.slice(0, 19)}  ${session.runId}`);
  }
  lines.push('');
  return lines.join('\n');
}

export function runTrainCycle(options: TrainCycleOptions = {}, mode: 'cycle' | 'resume' = 'cycle'): TrainCycleResult {
  const flow = inspectFlow({ repoPath: options.repoPath, configPath: options.configPath, runId: options.runRef ?? 'latest' });
  const adapterName = `repo-arch-${flow.manifest.run.headSha.slice(0, 7)}`;
  const adapterPath = path.join(flow.manifest.run.repoRoot, '.repo-arch', 'adapters', adapterName);
  const latestCheckpoint = findLatestAdapterCheckpoint(adapterPath);

  if (mode === 'resume' && !latestCheckpoint) {
    throw new Error(`No checkpoint found in ${adapterPath}. Run repo-arch train cycle first.`);
  }

  const plan = prepareTrain({
    repoPath: flow.manifest.run.repoRoot,
    outPath: path.join(flow.runDir, 'training'),
    model: options.model ?? flow.manifest.config.training.model,
    iters: options.iters ?? flow.manifest.config.training.iters,
    learningRate: options.learningRate ?? flow.manifest.config.training.learningRate,
    adapterName,
    resumeAdapterFile: latestCheckpoint ?? undefined,
  });

  writeJson(path.join(flow.runDir, 'training', 'train-plan.json'), {
    schemaVersion: 1,
    ...plan,
    note: 'Use repo-arch train cycle to continue training or train run for a one-shot run.',
  });

  const resumeAdapterFile = latestCheckpoint;
  const sessionPathValue = sessionPath(flow.runDir);
  const cyclesPathValue = cyclesPath(flow.runDir);
  const session = createSession(flow, plan, resumeAdapterFile);
  session.status = 'running';
  writeJson(sessionPathValue, session);

  appendJsonl(cyclesPathValue, {
    schemaVersion: 1,
    sessionId: session.sessionId,
    runId: session.runId,
    mode,
    startedAt: now(),
    command: plan.command,
    resumeAdapterFile,
    adapterPath: plan.adapterPath,
  });

  try {
    execSync(plan.command.replace(/\\\n  /g, ' '), {
      stdio: 'inherit',
      cwd: flow.manifest.run.repoRoot,
    });
    const afterCheckpoint = findLatestAdapterCheckpoint(plan.adapterPath);
    session.status = 'ok';
    session.updatedAt = now();
    session.command = plan.command;
    session.latestCheckpoint = afterCheckpoint;
    writeJson(sessionPathValue, session);
    appendJsonl(cyclesPathValue, {
      schemaVersion: 1,
      sessionId: session.sessionId,
      runId: session.runId,
      mode,
      finishedAt: session.updatedAt,
      status: 'ok',
      latestCheckpoint: afterCheckpoint,
    });
  } catch (error) {
    session.status = 'failed';
    session.updatedAt = now();
    session.command = plan.command;
    writeJson(sessionPathValue, session);
    appendJsonl(cyclesPathValue, {
      schemaVersion: 1,
      sessionId: session.sessionId,
      runId: session.runId,
      mode,
      finishedAt: session.updatedAt,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  return {
    flow,
    plan,
    session,
    sessionPath: sessionPathValue,
    cyclesPath: cyclesPathValue,
    resumeAdapterFile,
  };
}
