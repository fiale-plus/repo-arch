import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CardStatus } from './cards.js';

export type ReviewEntry = {
  status: CardStatus;
  updatedAt: string;
};

export type ReviewMap = Record<string, ReviewEntry>;

const REVIEW_FILE = '.repo-arch/review-state.json';

function reviewFilePath(repoRoot: string): string {
  return path.join(repoRoot, REVIEW_FILE);
}

export function loadReviewState(repoRoot: string): ReviewMap {
  const filePath = reviewFilePath(repoRoot);
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as ReviewMap;
  } catch {
    return {};
  }
}

export function saveReviewState(repoRoot: string, state: ReviewMap): void {
  const filePath = reviewFilePath(repoRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

export function setCardStatus(repoRoot: string, cardId: string, status: CardStatus): ReviewEntry | null {
  const state = loadReviewState(repoRoot);
  state[cardId] = { status, updatedAt: new Date().toISOString() };
  saveReviewState(repoRoot, state);
  return state[cardId];
}

export function getCardStatus(repoRoot: string, cardId: string): ReviewEntry | null {
  const state = loadReviewState(repoRoot);
  return state[cardId] ?? null;
}

export function listReviewState(repoRoot: string): ReviewMap {
  return loadReviewState(repoRoot);
}

export function getStatusOverrideMap(repoRoot: string): Record<string, CardStatus> {
  const state = loadReviewState(repoRoot);
  const overrides: Record<string, CardStatus> = {};
  for (const [id, entry] of Object.entries(state)) {
    if (entry.status === 'accepted' || entry.status === 'rejected') {
      overrides[id] = entry.status;
    }
  }
  return overrides;
}
