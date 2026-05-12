import * as assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadReviewState, saveReviewState, setCardStatus, getCardStatus, listReviewState, getStatusOverrideMap } from '../src/review.js';

const CARD_ID = 'abc123def4567890';

test('loadReviewState returns empty for missing file', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'review-test-'));
  const state = loadReviewState(tmp);
  assert.deepEqual(state, {});
});

test('saveReviewState and loadReviewState round-trip', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'review-test-'));
  saveReviewState(tmp, { [CARD_ID]: { status: 'accepted', updatedAt: '2026-01-01T00:00:00Z' } });
  const state = loadReviewState(tmp);
  assert.equal(state[CARD_ID]?.status, 'accepted');
});

test('setCardStatus writes and returns entry', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'review-test-'));
  const entry = setCardStatus(tmp, CARD_ID, 'rejected');
  assert.equal(entry?.status, 'rejected');
  assert.ok(entry?.updatedAt.length > 0);

  const state = loadReviewState(tmp);
  assert.equal(state[CARD_ID]?.status, 'rejected');
});

test('getCardStatus returns null for unknown card', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'review-test-'));
  const entry = getCardStatus(tmp, 'nonexistent');
  assert.equal(entry, null);
});

test('getStatusOverrideMap only includes accepted and rejected', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'review-test-'));
  setCardStatus(tmp, 'card-a', 'accepted');
  setCardStatus(tmp, 'card-b', 'rejected');
  setCardStatus(tmp, 'card-c', 'stale');

  const map = getStatusOverrideMap(tmp);
  assert.equal(map['card-a'], 'accepted');
  assert.equal(map['card-b'], 'rejected');
  assert.equal(map['card-c'], undefined, 'stale should not be in override map');
});

test('listReviewState returns all entries', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'review-test-'));
  setCardStatus(tmp, 'card-a', 'accepted');
  setCardStatus(tmp, 'card-b', 'rejected');
  const all = listReviewState(tmp);
  assert.equal(Object.keys(all).length, 2);
});
