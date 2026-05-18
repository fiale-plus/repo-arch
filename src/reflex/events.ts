/**
 * reflex events — append-only event log for approvals, blocks, overrides.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

export type EventKind =
  | 'command_allowed'
  | 'command_asked'
  | 'command_blocked'
  | 'edit_classified'
  | 'test_plan_generated'
  | 'pi_hook_triggered'
  | 'pi_hook_decision'
  | 'override_applied'
  | 'session_failure'
  | 'reflex_training_started'
  | 'reflex_training_completed';

export type EventMeta = {
  repo?: string;
  sessionId?: string;
  user?: string;
  timestamp?: string;
};

export type ReflexEvent = {
  id: string;
  timestamp: string;
  kind: EventKind;
  payload: Record<string, unknown>;
  meta: EventMeta;
};

const EVENTS_FILE = '.repo-arch/reflex/events.jsonl';

function getEventsPath(repoDir: string): string {
  return path.join(repoDir, EVENTS_FILE);
}

function newId(): string {
  return crypto.randomBytes(8).toString('hex');
}

function now(): string {
  return new Date().toISOString();
}

/**
 * Append an event to the reflex events log.
 */
export function logEvent(
  repoDir: string,
  kind: EventKind,
  payload: Record<string, unknown>,
  meta: EventMeta = {}
): ReflexEvent {
  const event: ReflexEvent = {
    id: newId(),
    timestamp: now(),
    kind,
    payload,
    meta: { ...meta, repo: repoDir },
  };

  const eventsPath = getEventsPath(repoDir);
  const dir = path.dirname(eventsPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.appendFileSync(eventsPath, JSON.stringify(event) + '\n', 'utf8');
  return event;
}

/**
 * Load all reflex events from a repo.
 */
export function loadEvents(repoDir: string): ReflexEvent[] {
  const eventsPath = getEventsPath(repoDir);
  if (!fs.existsSync(eventsPath)) return [];

  const content = fs.readFileSync(eventsPath, 'utf8');
  return content
    .split('\n')
    .filter(l => l.trim())
    .map(l => {
      try { return JSON.parse(l); }
      catch { return null; }
    })
    .filter(Boolean) as ReflexEvent[];
}

/**
 * Count events by kind.
 */
export function countByKind(events: ReflexEvent[]): Record<EventKind, number> {
  const counts = {} as Record<EventKind, number>;
  for (const e of events) {
    counts[e.kind] = (counts[e.kind] || 0) + 1;
  }
  return counts;
}

/**
 * Load and summarize recent events.
 */
export function summarizeEvents(repoDir: string, limit = 100): string {
  const events = loadEvents(repoDir).slice(-limit);
  const counts = countByKind(events);

  const lines = [`Reflex events: ${events.length} total (last ${limit})`, ''];
  for (const [kind, count] of Object.entries(counts)) {
    lines.push(`  ${kind}: ${count}`);
  }
  return lines.join('\n');
}