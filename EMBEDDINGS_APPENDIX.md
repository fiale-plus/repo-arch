# Appendix: Embeddings in Repo-Arch / Essence

## Summary

Embeddings are beneficial and should be included early, but they are **not the product moat by themselves**.

The product moat remains:

```text
extraction + validation + evidence-linked project memory cards + agent/tool integration
```

Embeddings are the connective tissue that makes that pipeline work on messy real-world repositories. They help the system find related history, link weak traces across sources, deduplicate repeated decisions, detect stale memories, and retrieve the right evidence at serving time.

The core doctrine:

```text
Embeddings find the memories.
Cards certify the memories.
RAG cites the memories.
Adapters internalize the habits.
MCP exposes the memories to agents.
```

For MVP, embeddings are more important than fine-tuning. Fine-tuning can remain optional until the extraction, card, retrieval, and evaluation layers are useful.

---

## Where Embeddings Fit

Repo-Arch should use embeddings in three phases:

```text
1. Mining / extraction
2. Validation / dataset hygiene
3. Serving / retrieval
```

They should not replace structured project-memory cards. The system should not be a generic vector-search chatbot over git history. Instead, embeddings should help produce and retrieve validated artifacts such as:

```text
Decision cards
Regression cards
Migration cards
Norm cards
Ownership cards
Co-change/test-gap records
```

---

## Why Embeddings Matter

### 1. RAG Retrieval

This is the obvious use case.

When a user asks:

```text
Why is auth middleware token-only?
```

The system embeds the query, retrieves semantically similar decision/regression cards, and passes them to the answering model or MCP tool.

This matters because user questions rarely match the exact language in commits, PRs, or Slack.

Example semantic bridge:

```text
User: "Why don't we call the database in middleware?"
Decision card: "Avoid DB client in edge runtime auth middleware"
Slack thread: "package X explodes on edge"
PR: "remove server client from middleware"
```

Keyword search may miss this. Embeddings can connect it.

---

### 2. Cross-Source Evidence Linking

This may be the highest-value use of embeddings.

Real project decisions are fragmented:

```text
Slack: "edge runtime breaks package X"
PR: "switch auth middleware to Node runtime due to compatibility issue"
Commit: "remove db client from middleware"
Issue: "deployment failure in auth path"
```

There may be little exact string overlap. Embeddings can cluster these traces and propose that they belong to the same project memory.

The extractor can then generate a decision card:

```yaml
type: decision
title: Avoid DB access in auth middleware
decision: Middleware should perform token-level validation only.
rationale: DB/client access previously caused edge-runtime deployment failures.
evidence:
  - PR #184
  - commit abc123
  - Slack #backend thread, 2026-03-14
confidence: high
status: active
```

This is a real moat: not using embeddings, but using embeddings to link weak historical traces into validated decision cards.

---

### 3. Deduplication Before Training

The same decision may appear in:

```text
one PR description
three commit messages
two review comments
one Slack thread
one Linear/Jira ticket
```

If all of these become separate training rows, the adapter overweights one decision and becomes biased toward repeating it.

Embedding-based clustering can collapse near-duplicates into one canonical memory record.

Recommended flow:

```text
extracted records
  -> embed
  -> cluster by similarity
  -> canonicalize
  -> preserve all evidence links
  -> generate one clean card
  -> generate controlled training examples from card
```

This improves dataset quality more than simply adding more rows.

---

### 4. Staleness and Drift Detection

Simple staleness checks are useful:

```text
Does the referenced file still exist?
Does the package still exist?
Was the decision superseded by a newer PR?
```

Embeddings can add semantic drift detection.

Example:

```text
Old decision: auth/middleware.ts avoids DB client because it runs on edge.
Current file: auth/middleware.ts now delegates to server-only route handlers and no longer runs on edge.
```

The file still exists, but the meaning has changed. Embedding the old decision/card and current file/module summaries can help flag drift.

This should not be the only staleness mechanism. It should be a signal:

```yaml
staleness:
  file_exists: true
  referenced_package_exists: false
  newer_conflicting_card: true
  semantic_drift_score: 0.72
  status: needs_review
```

Staleness handling is a product differentiator because stale tribal knowledge is dangerous.

---

### 5. Commit / PR Classification

Before extracting decisions, the system needs to classify history:

```text
decision
bug fix
regression fix
refactor
migration
chore
test-only change
style/noise
```

Rules and keyword matching help, but real commit messages are messy. A small classifier using embeddings plus simple features can work well:

```text
embedding(commit message + PR title + summarized diff)
+ metadata features
+ lightweight classifier
```

This can run locally and quickly.

Useful metadata features:

```text
files touched
number of files changed
presence of tests
presence of revert/fix/because/avoid/remove/migrate
linked issue/PR
author/reviewer
age of commit
```

This classification determines which records deserve SOTA extraction calls and which should be ignored.

---

### 6. Similar Past Changes

A strong feature:

```bash
repo-arch similar --diff HEAD
```

The system embeds a summary of the current diff and retrieves similar historical changes:

```text
similar migrations
similar bug fixes
similar regressions
similar reviewer objections
similar test updates
```

This supports features like:

```bash
repo-arch check-diff
repo-arch missing-tests --diff HEAD
repo-arch review-with-history --diff HEAD
```

This is one of the best places embeddings create immediate value without fine-tuning.

---

## What Embeddings Should Not Do

Embeddings should not become the whole product.

A weak product says:

```text
Here are five vaguely related Slack/GitHub chunks.
```

A strong product says:

```text
The active decision is X.
The rationale is Y.
The evidence is PR #184, commit abc123, and Slack thread C.
Confidence is high.
Staleness risk is low.
This diff may violate the decision.
```

Embeddings alone do not know:

```text
which source is authoritative
which decision is active or superseded
whether a Slack opinion became actual code
whether a commit reverted the decision
whether a memory is stale
whether two sources contradict each other
```

That requires structured extraction, validation, status tracking, and evidence linking.

---

## Recommended Architecture

### Mining / Extraction

```text
Git commits / PRs / issues / Slack / tickets
  -> chunk and summarize
  -> embed chunks
  -> cluster related traces
  -> classify candidate memories
  -> extract cards with SOTA or local model
  -> attach evidence links
```

### Validation

```text
cards
  -> embed cards
  -> deduplicate near-duplicates
  -> detect contradictions
  -> detect semantic drift
  -> score confidence
  -> mark active/superseded/deprecated/needs_review
  -> optionally human review
```

### Training

```text
validated cards
  -> generate task examples
  -> create train/eval splits
  -> train optional LoRA adapter with MLX-LM or other backend
  -> evaluate against base prompt + RAG baseline
```

### Serving

```text
query or diff
  -> router
  -> structured lookup by path/module/status
  -> embedding retrieval over cards
  -> raw evidence fallback if needed
  -> answer with citations/evidence
  -> optional fine-tuned adapter for repo-native style/reflexes
```

---

## Retrieval Layers

Use three retrieval layers, in this order.

### Layer 1: Structured Lookup

Use deterministic filters first:

```text
path scope
module
package/dependency
decision type
status
confidence
date
source type
```

Example:

```bash
repo-arch why src/auth/middleware.ts
```

First retrieve cards whose scope includes that path.

### Layer 2: Embedding Search Over Cards

Then use semantic search over card fields:

```text
title
decision
rationale
avoid/prefer fields
summary
tags
```

This handles fuzzy questions and vocabulary mismatch.

### Layer 3: Embedding Search Over Raw Evidence

Only then fall back to raw or lightly summarized evidence:

```text
PR summaries
issue summaries
Slack thread summaries
commit summaries
review comments
ADR/docs chunks
```

Raw evidence fallback should be clearly marked as less validated.

---

## What to Embed

Recommended:

```text
decision cards
regression cards
migration cards
norm cards
PR summaries
issue summaries
Slack thread summaries
commit summaries
diff summaries
review comments
ADR/docs chunks
```

Avoid making huge raw diffs the primary embedding unit. Prefer:

```text
raw diff -> summarized change/rationale -> embed summary
```

Keep raw diffs linked as evidence.

Good chunk format for git history:

```text
PR title
PR description summary
commit message
summarized diff
files touched
linked issues
review comment summary
```

Good chunk format for Slack:

```text
channel
thread date
participants
thread summary
decision candidate
linked PR/issue references
```

---

## Storage Recommendation

For MVP, prefer a local, simple, inspectable index.

Recommended default:

```text
SQLite + sqlite-vec
```

Why:

```text
single local file
easy to bundle with CLI
easy to inspect/debug
works offline
fits repo-arch's local-first story
```

Alternative options:

```text
LanceDB: good local vector store, more featureful
Chroma: easy prototyping, common ecosystem
Qdrant local: strong engine, more operational weight
.npz files: acceptable for very early prototype only
```

Suggested files:

```text
.repo-arch/index/repo_memory.sqlite
.repo-arch/cards/decisions.yaml
.repo-arch/cards/regressions.yaml
.repo-arch/cards/migrations.yaml
.repo-arch/cards/norms.yaml
```

For committed repo artifacts, prefer committing cards/config/evals and either:

```text
commit small index if safe and small
or rebuild index from committed cards with repo-arch index
```

Do not commit private raw Slack data.

---

## Embedding Models

The exact best embedding model will change. The product should abstract over embedding providers.

Initial practical defaults:

```text
Default local: nomic-embed-text or BGE/E5-class small model
Tiny/prototype: all-MiniLM-L6-v2
Higher-quality multilingual/general: BGE-M3 or Qwen embedding-class model
Code-heavy future option: code-aware embedding model if needed
```

Selection criteria:

```text
local/offline support
speed on Apple Silicon
quality on natural language + code-adjacent text
license suitability
easy packaging
reasonable vector dimension
works with Python CLI
```

For MVP, do not over-optimize model choice. The bigger win is the card schema, evidence linking, and validation workflow.

The CLI should support:

```bash
repo-arch index --embedder nomic
repo-arch index --embedder bge-small
repo-arch index --embedder minilm
repo-arch index --embedder custom --model path_or_name
```

---

## CLI Commands

### Build Index

```bash
repo-arch index --embedder nomic
```

Embeds cards and summaries into the local vector store.

### Ask Why

```bash
repo-arch why src/auth/middleware.ts
```

Retrieval order:

```text
1. path-scoped active cards
2. semantic card search
3. raw evidence fallback
4. answer with evidence links
```

### Similar History

```bash
repo-arch similar --diff HEAD
```

Finds similar prior PRs, commits, regressions, migrations, and review comments.

### Check Diff

```bash
repo-arch check-diff --diff HEAD
```

Combines:

```text
path-scoped decision cards
regression cards
semantic similarity to old bug fixes
co-change/test-gap graph
optional adapter-generated review comments
```

### Deduplicate Cards

```bash
repo-arch dedupe
```

Clusters similar cards and proposes canonical records.

### Validate Staleness

```bash
repo-arch validate-staleness
```

Uses deterministic checks plus semantic drift signals.

---

## Role in Fine-Tuning

Embeddings should usually come before fine-tuning.

Recommended implementation order:

```text
1. extraction
2. cards
3. embedding index
4. MCP tools
5. evals
6. optional fine-tuning
```

Fine-tuning should be trained from validated cards and generated task examples, not directly from raw git/Slack history.

Correct flow:

```text
raw history
  -> embeddings help cluster/link
  -> validated cards
  -> generated train/eval examples
  -> optional adapter
```

Bad flow:

```text
raw history
  -> direct training rows
```

The adapter should learn:

```text
repo-specific review instincts
how to apply retrieved decisions
how to phrase warnings
how to format answers
how to avoid generic assistant behavior
```

The adapter should not be trusted as the sole source of factual evidence.

---

## Example: Middleware Decision

### Raw traces

```text
Slack: "edge runtime breaks package X"
PR: "remove db client from middleware"
Commit: "switch auth middleware away from package X"
Issue: "auth deployment failure"
```

### Embedding-assisted cluster

```text
cluster_id: auth-middleware-edge-runtime
members:
  - slack thread C
  - PR #184
  - commit abc123
  - issue #4821
```

### Validated card

```yaml
type: decision
title: Avoid DB/client access in auth middleware
decision: Middleware should only perform token-level auth checks.
rationale: Direct DB/client access previously caused edge-runtime deployment failures.
scope:
  paths:
    - src/middleware.ts
    - src/auth/*
avoid:
  - importing database clients in middleware
  - using package X in edge runtime
prefer:
  - token verification in middleware
  - DB-backed checks in server routes/actions
evidence:
  - type: pr
    id: 184
  - type: commit
    sha: abc123
  - type: slack
    channel: backend
    thread: C
confidence: high
status: active
staleness_risk: low
```

### Serving answer

```text
This file avoids DB/client access because middleware previously failed in edge runtime when package X was imported there.

Current rule:
- middleware: token-only validation
- server routes/actions: DB-backed auth checks

Evidence:
- PR #184
- commit abc123
- Slack #backend thread C
```

---

## MVP Decision

Embeddings should be included in the MVP, but in a focused way.

MVP scope:

```text
Embed generated cards and summaries.
Use embeddings for retrieval, evidence linking, dedupe, and similar-history search.
Store locally in SQLite/sqlite-vec or a similarly simple local store.
Do not depend on fine-tuning for first value.
```

The first useful version should answer:

```bash
repo-arch why <path>
repo-arch similar --diff HEAD
repo-arch check-diff
```

using:

```text
structured cards + local embedding retrieval + evidence links
```

Fine-tuning becomes a later optimization for speed, tone, and repo-native reflexes.

---

## Final Position

Embeddings are not the defensible product.

But without embeddings, repo-arch risks becoming a brittle keyword-search tool that misses cross-source links, duplicates training data, and serves stale decisions confidently.

The correct position:

```text
Embeddings are mandatory connective tissue.
Validated project-memory cards are the core artifact.
MCP tools are the interface.
Fine-tuning is optional acceleration.
```

This makes Repo-Arch both practical and defensible.
