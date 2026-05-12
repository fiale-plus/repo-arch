import { type GitHistoryRecord } from './git-history.js';

export type SignalDef = {
  type: string;
  label: string;
  /** Regex patterns matched against commit subject */
  subjectPatterns: RegExp[];
  /** File-path patterns checked when subject match is weak */
  filePatterns?: RegExp[];
  /** Base confidence (0-1). Higher = stronger signal */
  baseConfidence: number;
};

export type CommitSignal = {
  type: string;
  label: string;
  confidence: number;
  matchedOn: 'subject' | 'file';
};

export type ClassifiedCommit = GitHistoryRecord & {
  signals: CommitSignal[];
};

export const SIGNAL_DEFS: SignalDef[] = [
  {
    type: 'fix',
    label: 'Bug fix',
    subjectPatterns: [
      /^(fix|bugfix|hotfix)[\s(:]/i,
      /\bfix(e[sd])?\b/i,
      /\bbug\b/i,
      /\bhotfix\b/i,
      /\bpatch\b/i,
      /\bresolve[ds]?\b/i,
      /\bregression\b/i,
    ],
    baseConfidence: 1.0,
  },
  {
    type: 'revert',
    label: 'Revert',
    subjectPatterns: [
      /^revert[\s(:]/i,
      /this reverts/i,
      /back out/i,
      /undo\b/i,
    ],
    baseConfidence: 1.0,
  },
  {
    type: 'rationale',
    label: 'Contains rationale',
    subjectPatterns: [
      /\bbecause\b/i,
      /\bsince\b/i,
      /\bto avoid\b/i,
      /\bin order to\b/i,
      /\breason\b/i,
      /\bavoid\b/i,
      /\bprevent\b/i,
      /\btrade[ -]off\b/i,
      /\bwe choose?\b/i,
      /\bthe reason\b/i,
      /\bnecessitates?\b/i,
    ],
    baseConfidence: 0.7,
  },
  {
    type: 'migration',
    label: 'Migration / structural change',
    subjectPatterns: [
      /^migrate[\s(:]/i,
      /\bmigrat(e|ion)\b/i,
      /\brename\b/i,
      /\bwrap\b/i,
      /\brestructure\b/i,
      /\breplace\b/i,
      /\bconsolidate\b/i,
      /\bsplit\b/i,
    ],
    filePatterns: [/^R\d*\t/],
    baseConfidence: 0.8,
  },
  {
    type: 'deprecate',
    label: 'Deprecation',
    subjectPatterns: [
      /^deprecat/i,
      /\bdeprecat\w+\b/i,
      /\bwill be removed\b/i,
      /\bno longer supported\b/i,
    ],
    baseConfidence: 0.9,
  },
  {
    type: 'refactor',
    label: 'Refactor',
    subjectPatterns: [
      /^refactor/i,
      /\brefactor(or|ing)?\b/i,
      /\brewrite\b/i,
      /\bcleanup\b/i,
      /\bsimplif(y|ies|ied|ying)\b/i,
    ],
    baseConfidence: 0.8,
  },
  {
    type: 'test',
    label: 'Test change',
    subjectPatterns: [
      /^test[\s(:]/i,
      /\badd.*test/i,
      /\bupdate.*test/i,
      /\bfix.*test/i,
      /\btest.*case/i,
      /\bspec\b/i,
    ],
    filePatterns: [/\.test\./, /\.spec\./, /__tests__\//, /\/test\//],
    baseConfidence: 0.7,
  },
  {
    type: 'docs',
    label: 'Documentation',
    subjectPatterns: [
      /^docs?[\s(:]/i,
      /\bdocument/i,
      /\bREADME\b/i,
    ],
    filePatterns: [/\.md$/, /\.mdx$/, /\/docs\//, /\/wiki\//],
    baseConfidence: 0.8,
  },
  {
    type: 'perf',
    label: 'Performance',
    subjectPatterns: [
      /^perf[\s(:]/i,
      /\bperformanc/i,
      /\bspeed\b/i,
      /\boptimize?\b/i,
      /\blatency\b/i,
      /\bthroughput\b/i,
    ],
    baseConfidence: 0.8,
  },
  {
    type: 'security',
    label: 'Security',
    subjectPatterns: [
      /^security/i,
      /\bsecurity\b/i,
      /\bCVE-/i,
      /\bexploit\b/i,
      /\bXSS\b/i,
      /\bSQL injection\b/i,
    ],
    baseConfidence: 0.9,
  },
  {
    type: 'experimental',
    label: 'Experimental',
    subjectPatterns: [
      /^experimental/i,
      /\bexperiment\b/i,
      /\bprototype?\b/i,
      /\bPoC\b/i,
      /\bproof of concept\b/i,
    ],
    baseConfidence: 0.7,
  },
  {
    type: 'config',
    label: 'Config / dependency change',
    subjectPatterns: [
      /^chore[\s(:]/i,
      /\bdependenc/i,
      /^bump\b/i,
      /\bconfig\b/i,
      /\bversion\b/i,
    ],
    filePatterns: [/package\.json$/, /\.config\./, /Dockerfile/, /docker-compose/, /\.ya?ml$/, /^\./, /Makefile/],
    baseConfidence: 0.6,
  },
];

export function classifyCommit(record: GitHistoryRecord, defs: SignalDef[] = SIGNAL_DEFS): ClassifiedCommit {
  const signals: CommitSignal[] = [];
  const subject = record.subject;

  for (const def of defs) {
    // Check subject first
    let matched = false;
    for (const pattern of def.subjectPatterns) {
      if (pattern.test(subject)) {
        signals.push({
          type: def.type,
          label: def.label,
          confidence: def.baseConfidence,
          matchedOn: 'subject',
        });
        matched = true;
        break;
      }
    }

    // If subject didn't match, try file patterns as fallback
    if (!matched && def.filePatterns) {
      for (const file of record.files) {
        for (const pattern of def.filePatterns) {
          if (pattern.test(file.path) || (file.oldPath && pattern.test(file.oldPath))) {
            signals.push({
              type: def.type,
              label: def.label,
              confidence: Math.round(def.baseConfidence * 0.8 * 100) / 100, // lower confidence for file-only match
              matchedOn: 'file',
            });
            matched = true;
            break;
          }
        }
        if (matched) break;
      }
    }
  }

  // Deduplicate by type (keep the first/highest confidence match)
  const seen = new Set<string>();
  const uniqueSignals: CommitSignal[] = [];
  for (const s of signals) {
    if (!seen.has(s.type)) {
      seen.add(s.type);
      uniqueSignals.push(s);
    }
  }

  return {
    ...record,
    signals: uniqueSignals,
  };
}

export function classifyHistory(records: GitHistoryRecord[], defs: SignalDef[] = SIGNAL_DEFS): ClassifiedCommit[] {
  return records.map(record => classifyCommit(record, defs));
}
