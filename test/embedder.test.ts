import * as assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { cosineSimilarity, loadIndex, saveIndex, searchIndex, type VectorIndex, type VectorEntry } from '../src/embedder.js';

function makeIndex(entries: Partial<VectorEntry>[] = []): VectorIndex {
  return {
    model: 'test-model',
    dim: 3,
    headSha: 'abc123',
    entries: entries.map(e => ({
      id: 'test-card',
      text: 'test entry',
      embedding: [1, 0, 0],
      source: 'card',
      metadata: {},
      ...e,
    })),
    createdAt: '2026-01-01T00:00:00Z',
  };
}

test('cosineSimilarity returns 1 for identical vectors', () => {
  const a = [1, 0, 0];
  const b = [1, 0, 0];
  assert.equal(cosineSimilarity(a, b), 1);
});

test('cosineSimilarity returns 0 for orthogonal vectors', () => {
  const a = [1, 0, 0];
  const b = [0, 1, 0];
  assert.equal(cosineSimilarity(a, b), 0);
});

test('cosineSimilarity returns negative for opposite vectors', () => {
  const a = [1, 0, 0];
  const b = [-1, 0, 0];
  assert.equal(cosineSimilarity(a, b), -1);
});

test('searchIndex returns top K results sorted by score', () => {
  const index = makeIndex([
    { id: 'a', embedding: [1, 0, 0] },
    { id: 'b', embedding: [0.9, 0.1, 0] },
    { id: 'c', embedding: [0, 1, 0] },
  ]);
  const query = [1, 0, 0];
  const results = searchIndex(index, query, 2);

  assert.equal(results.length, 2);
  assert.equal(results[0]!.entry.id, 'a');
  assert.equal(results[0]!.score, 1);
  assert.equal(results[1]!.entry.id, 'b');
});

test('searchIndex respects topK', () => {
  const index = makeIndex([
    { id: 'a', embedding: [1, 0, 0] },
    { id: 'b', embedding: [0.9, 0.1, 0] },
    { id: 'c', embedding: [0.8, 0.2, 0] },
  ]);
  const results = searchIndex(index, [1, 0, 0], 1);
  assert.equal(results.length, 1);
});

test('saveIndex and loadIndex round-trip', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'embed-test-'));
  const index = makeIndex([{ id: 'card-1', embedding: [1, 0, 0] }]);
  saveIndex(tmp, index);

  const loaded = loadIndex(tmp);
  assert.ok(loaded !== null);
  assert.equal(loaded!.entries.length, 1);
  assert.equal(loaded!.entries[0]!.id, 'card-1');
  assert.equal(loaded!.model, 'test-model');
});

test('loadIndex returns null for missing file', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'embed-test-'));
  const result = loadIndex(tmp);
  assert.equal(result, null);
});
