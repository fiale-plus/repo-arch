/**
 * reflex classify-command — guard shell commands before execution.
 *
 * Deterministic rules + package detection. No ML needed.
 */

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export const RISK_ALLOW = 'allow';
export const RISK_ASK = 'ask';
export const RISK_BLOCK = 'block';
export type Decision = typeof RISK_ALLOW | typeof RISK_ASK | typeof RISK_BLOCK;

export type CommandDecision = {
  decision: Decision;
  riskLevel: RiskLevel;
  reason: string;
  matchesRule?: string;
  alternatives?: string[];
};

const BLOCK_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  // Destructive writes
  [/\brm\s+-rf\s+\/(?!proc|sys|dev)/, 'rm -rf on root — destructive'],
  [/\brm\s+-rf\s+\/home/, 'rm -rf on /home — destructive'],
  [/\bdd\b/, 'dd command — can wipe disks'],
  [/\bmkfs\./, 'mkfs — can destroy filesystems'],
  [/\bdrop\s+database\b/i, 'drop database — destructive'],
  [/\bdelete\s+from\s+\w+\s*;/i, 'SQL delete without where — destructive'],
  [/\bshutdown\b/, 'shutdown — system termination'],
  [/\bpoweroff\b/, 'poweroff — system termination'],
  [/\|\s*sudo\s+/, 'sudo piping — may execute unexpected commands'],
  [/\bwget\s+.*\|\s*sh/, 'wget piped to sh — code injection risk'],
  [/\bcurl\s+.*\|\s*sh/, 'curl piped to sh — code injection risk'],
  // Credentials exposure
  [/(api[_-]?key|secret|token|password|credential)\s*=\s*["'][^"']+["']/i, 'hardcoded credential in command'],
];

const ASK_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  // System-level changes
  [/\bsudo\s+(apt|apk|yum|dnf|pacman)\b/i, 'sudo package manager — system modification'],
  [/\bkill\s+(-9|-SIGKILL)/, 'kill -9 — process termination'],
  [/\bpkill\b/, 'pkill — multiple process termination'],
  [/\bkillall\b/, 'killall — all processes termination'],
  [/chmod\s+777/, 'chmod 777 — world-readable/writable'],
  [/chmod\s+000/, 'chmod 000 — makes files inaccessible'],
  [/chmod\s+-R\s+777/, 'chmod -R 777 — recursive world access'],
  [/\binit\s+6\b/, 'init 6 — reboot'],
  [/\breboot\b/, 'reboot — system restart'],
  [/\bnpm\s+publish\b/i, 'npm publish — publish to registry'],
  [/\brm\s+-rf\s+node_modules/, 'rm -rf node_modules — loses dependencies'],
  [/\brm\s+-rf\s+\.git/, 'rm -rf .git — loses git history'],
  [/\bnpm\s+install\s+--save-dev\s+[A-Z]/, 'npm install with dev dep flag — modifies package.json'],
  [/\bgit\s+push\s+--force\b/, 'git push --force — can overwrite history'],
  [/\bgit\s+push\s+-f\b/, 'git push -f — force push'],
  [/\benv\s+-\s+\w+\s*=/, 'env - override env var — may affect subprocesses'],
  [/\beval\s+/, 'eval — dynamic code execution'],
  [/\bsh\s+-c\b/, 'sh -c — shell execution'],
];

const LOW_RISK_PREFIXES = ['git status', 'git log', 'git diff', 'git show', 'git branch', 'git remote -v', 'git config', 'git status --short', 'git describe', 'git rev-parse', 'git reflog', 'ls', 'pwd', 'find .', 'head -n', 'tail -n', 'grep -', 'cat ', 'wc -l', 'stat ', 'file '];

const DESTRUCTIVE_FLAGS = ['-rf', '-r --force', '-f', '--force', '--no-preserve-root'];

function detectPackageDir(cmd: string): string | null {
  // Heuristic: if command involves a package.json or specific workspace paths
  const pkgMatches = cmd.match(/(packages\/[\w-]+|apps\/[\w-]+|libs\/[\w-]+)/);
  return pkgMatches ? pkgMatches[1] : null;
}

function getDestructiveFlagWarnings(cmd: string): string[] {
  const warnings: string[] = [];
  for (const flag of DESTRUCTIVE_FLAGS) {
    if (cmd.includes(flag)) {
      warnings.push(`contains destructive flag: ${flag}`);
    }
  }
  return warnings;
}

export function classifyCommand(raw: string): CommandDecision {
  const cmd = raw.trim();

  // 1. Critical block patterns
  for (const { pattern, reason } of BLOCK_PATTERNS) {
    if (pattern.test(cmd)) {
      return {
        decision: RISK_BLOCK,
        riskLevel: 'critical',
        reason,
        matchesRule: pattern.source,
        alternatives: [],
      };
    }
  }

  // 2. Ask patterns
  for (const { pattern, reason } of ASK_PATTERNS) {
    if (pattern.test(cmd)) {
      const flags = getDestructiveFlagWarnings(cmd);
      return {
        decision: RISK_ASK,
        riskLevel: flags.length > 0 ? 'high' : 'medium',
        reason: flags.length > 0 ? `${reason} (${flags.join(', ')})` : reason,
        matchesRule: pattern.source,
        alternatives: [],
      };
    }
  }

  // 3. Check for package dir context
  const pkgDir = detectPackageDir(cmd);

  // 4. Check for likely read-only commands (case-insensitive prefix)
  const cmdNoArgs = cmd.split('&&')[0].split('|')[0].split(';')[0].trim();
  const lower = cmdNoArgs.toLowerCase();
  for (const prefix of LOW_RISK_PREFIXES) {
    if (lower.startsWith(prefix.toLowerCase())) {
      return {
        decision: RISK_ALLOW,
        riskLevel: 'low',
        reason: 'read-only git/system query',
        matchesRule: 'low-risk-prefix',
      };
    }
  }

  // 5. Allow safe npm/node scripts
  if (/^(npm\s+(run| exec| explore)|node\s+script|npx\s+\S)/.test(cmd)) {
    return {
      decision: RISK_ALLOW,
      riskLevel: 'low',
      reason: 'safe package script',
    };
  }

  // 6. Default: ask for commands we can't trivially classify
  if (/[;`$]|>>|2>&|&$/.test(cmd)) {
    return {
      decision: RISK_ASK,
      riskLevel: 'medium',
      reason: 'contains shell metacharacters — may have side effects',
      matchesRule: 'shell-metachar',
    };
  }

  return {
    decision: RISK_ALLOW,
    riskLevel: 'low',
    reason: 'unclassified — default allow after basic checks',
  };
}

// Convenience CLI output
export function formatDecision(decision: CommandDecision, cmd: string): string {
  const emoji = decision.decision === RISK_BLOCK ? '[BLOCK]' :
                decision.decision === RISK_ASK   ? '[ASK]'   : '[ALLOW]';
  return `${emoji} risk=${decision.riskLevel} reason="${decision.reason}" cmd="${cmd.substring(0, 80)}"`;
}