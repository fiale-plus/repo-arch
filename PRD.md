# PRD: Project Archaeology / Repo Memory MCP

## 1. Working Name

**Repo-Arch**  
Alternative names: **Strata**, **Repo Memory**, **Project Archaeologist**, **Fossil**, **Essence**.

Recommended public framing:

> Turn project history into local agent memory.

More explicit developer tagline:

> Mine GitHub, Git history, PRs, issues, and Slack traces into validated decision memory that Claude, Codex, Cursor, and local agents can call through MCP.

---

## 2. Product Thesis

Modern AI coding agents are powerful but historically blind. They can inspect the current codebase, but they usually do not know the project scars that shaped it:

- why one architecture was chosen over another;
- what broke before;
- what alternatives were rejected;
- which hidden constraints matter;
- what senior engineers keep in their heads;
- where Slack/PR/Jira discussions contain the real rationale.

**Repo-Arch** performs project archaeology once, converts scattered history into validated memory objects, and exposes them locally to humans and AI agents.

The product is **not** a generic chatbot and not primarily a fine-tuning product.

The core product is:

```text
Git history / GitHub PRs / issues / Slack / Jira / Linear
        ↓
project archaeology extraction
        ↓
decision cards + regression cards + migration cards + norm cards
        ↓
validation / evidence linking / staleness checks / confidence scoring
        ↓
local repo-memory index
        ↓
CLI + MCP tools for Claude, Codex, Cursor, local agents
        ↓
optional repo-specific LoRA adapter for fast reflexes and team style
```

The moat is the **extraction and validation pipeline**, not model weights.

---

## 3. Problem

Engineering teams accumulate critical knowledge in places that are painful for humans and AI agents to search repeatedly:

- commit diffs and commit messages;
- PR descriptions and review threads;
- GitHub issues;
- Slack architecture discussions;
- Jira/Linear tickets;
- incident notes;
- migration branches;
- reverted commits;
- one-off bug investigations.

The current code answers **what exists now**. History explains **why it exists**.

Today, a developer or coding agent asking:

> Why do we avoid database access in middleware?

may need to manually inspect:

```text
git log --follow -p -- src/middleware.ts
gh pr list / gh pr view
gh issue search
Slack search in #backend and #architecture
Jira ticket links
old incident docs
```

A frontier model could do some of this if given enough context and tool access, but doing that for every question is slow, expensive, and unreliable. The work should be done once, validated, and served locally.

---

## 4. Target Users

### Primary

**Engineering teams using AI coding tools** who want their AI agents to understand project history and team-specific constraints.

### Secondary

- new hires onboarding into large or old codebases;
- senior engineers tired of repeating tribal knowledge;
- platform teams managing migrations and architecture decisions;
- maintainers of open-source projects with long Git history;
- local-first AI / LocalLLaMA power users;
- companies with strict privacy requirements who want local project memory.

---

## 5. Core Use Cases

### 5.1 Explain Historical Decisions

Question:

> Why did we choose Redis for sessions instead of Postgres?

Expected answer:

```text
Redis was chosen after March 2024 load testing showed Postgres added roughly 40ms p99 latency for session reads. The team decided to keep session reads off the primary database and documented the tradeoff in PR #892.

Evidence:
- PR #892: session storage migration
- commit abc123: introduce Redis-backed session store
- Slack #architecture thread, 2024-03-14
```

### 5.2 Detect Regression Patterns in a Diff

Input:

```bash
repo-arch check-diff
```

Expected answer:

```text
⚠️ Possible regression: edge-runtime middleware issue

This diff imports package X in src/middleware.ts. A similar pattern was removed in PR #184 after edge runtime deployment failures.

Suggested review comment:
"Can we avoid importing package X in middleware? This previously broke edge runtime; prefer token-only validation here and move DB-backed checks to server code."

Evidence:
- PR #184
- commit abc123
- Slack #backend thread, 2026-03-14
```

### 5.3 Suggest Missing Tests Based on History

Input:

```bash
repo-arch missing-tests --diff HEAD
```

Expected answer:

```text
This change modifies src/billing/prices.ts.

Historically, similar changes also touched:
- tests/billing/prices.test.ts, 82% of cases
- src/billing/fixtures.ts, 39% of cases
- docs/billing.md, 44% of cases

Suggested:
- add pricing edge-case tests
- update annual discount fixture
- verify docs if behavior changed
```

### 5.4 New-Hire Project Archaeology

Question:

> Walk me through why checkout is split into two services.

Expected answer:

A concise historical explanation with links to PRs, commits, Slack threads, and current files.

### 5.5 Repo-Specific AI Review

An agent calls:

```text
repo_memory.review_with_history(diff)
```

It receives project-specific warnings that a generic model would not know:

- old bugs being reintroduced;
- project-specific banned patterns;
- migration rules;
- missing tests based on co-change history;
- team review norms.

---

## 6. Non-Goals

Repo-Arch is **not**:

- a generic coding assistant competing with Claude/Codex;
- a docs chatbot;
- a general RAG wrapper;
- an “upload everything and get an AI employee” product;
- a fine-tune-anything platform;
- a replacement for existing AI coding tools;
- a model that memorizes all project facts.

The correct relationship with Claude/Codex/Cursor:

> Claude/Codex remains the smart planner and general coding model. Repo-Arch supplies local project memory, historical evidence, and repo-specific reflex tools.

---

## 7. Product Primitive: Memory Cards

The central abstraction is a validated **memory card**.

Cards are inspectable, versionable, and usable for:

- CLI answers;
- MCP retrieval;
- local RAG;
- dataset generation;
- optional fine-tuning;
- human review;
- onboarding docs.

### 7.1 Decision Card

```yaml
type: decision
id: decision-auth-middleware-edge-runtime
title: Avoid DB access in middleware
decision: Middleware must only perform token-level auth checks.
rationale: Direct DB/client access broke edge runtime deployment.
scope:
  paths:
    - src/middleware.ts
    - src/auth/*
avoid:
  - importing database clients in middleware
  - calling package X from edge runtime
prefer:
  - token verification
  - server-side auth checks after routing
evidence:
  - type: pr
    id: 184
    url: https://github.com/org/repo/pull/184
    summary: Removed DB access from middleware after edge runtime failure.
  - type: commit
    sha: abc123
    summary: Replace package X usage in middleware.
  - type: slack
    channel: "#backend"
    thread_ts: "2026-03-14T10:22:00Z"
    summary: Team confirmed package X is incompatible with edge runtime.
confidence: 0.91
staleness_risk: low
status: active
last_verified: 2026-05-12
```

### 7.2 Regression Card

```yaml
type: regression
id: regression-edge-middleware-db-client
title: DB client import in middleware breaks edge runtime
symptom: Deployment failure in edge runtime when package X is imported.
trigger_pattern:
  paths:
    - src/middleware.ts
  code_patterns:
    - "import { db }"
    - "package X"
recommended_action: Move DB-backed auth checks out of middleware.
evidence:
  - type: pr
    id: 184
  - type: issue
    id: 4821
confidence: 0.88
status: active
```

### 7.3 Migration Card

```yaml
type: migration
id: migration-session-postgres-to-redis
title: Move session reads from Postgres to Redis
old_pattern: Postgres-backed session reads on every request.
new_pattern: Redis-backed session reads with DB fallback only in server routes.
rationale: Postgres added unacceptable p99 latency under load.
examples:
  - before_commit: old123
    after_commit: new456
evidence:
  - type: pr
    id: 892
confidence: 0.86
status: active
```

### 7.4 Norm Card

```yaml
type: norm
id: norm-review-missing-tests-for-billing
scope:
  paths:
    - src/billing/*
norm: Billing logic changes should include explicit edge-case tests.
reason: Past regressions occurred when pricing fixtures were not updated.
evidence:
  - type: pr_comment
    pr: 723
  - type: pr_comment
    pr: 811
  - type: issue
    id: 1442
confidence: 0.79
status: active
```

---

## 8. Fine-Tune vs RAG Architecture

Repo-Arch should use both, but for different layers.

### RAG / Local Index Handles

- exact facts;
- commit hashes;
- PR links;
- dates;
- issue links;
- Slack thread pointers;
- current file references;
- evidence citations;
- staleness and status.

### Fine-Tune / Adapter Handles

- team answer style;
- repo-specific review grammar;
- classification of risks;
- recognizing decision patterns;
- applying retrieved memory cards to new diffs;
- concise output formatting;
- “senior engineer from this team” tone;
- fast local reflexes.

### Required Principle

```text
RAG remembers facts.
Fine-tunes learn habits.
Tools verify reality.
Evals decide whether training helped.
```

Fine-tuning is optional acceleration and style compression, not the foundation of truth.

---

## 9. CLI Product Surface

### 9.1 MVP CLI

```bash
repo-arch init
repo-arch mine
repo-arch cards
repo-arch why <path-or-topic>
repo-arch check-diff
repo-arch missing-tests --diff HEAD
repo-arch install-mcp
```

### 9.2 Later CLI

```bash
repo-arch connect github
repo-arch connect slack-export ./slack-export
repo-arch connect linear
repo-arch extract --since "6 months ago" --focus "middleware OR edge runtime"
repo-arch validate
repo-arch review-cards
repo-arch dataset --skill review
repo-arch train --backend mlx-lm --model qwen-3b
repo-arch eval
repo-arch internalize
repo-arch pack
```

### 9.3 Example First-Run Flow

```bash
git clone github.com/company/payments-service
cd payments-service
npx repo-arch mine
npx repo-arch why src/auth/middleware.ts
npx repo-arch install-mcp
```

---

## 10. MCP Tools

MCP is the primary agent-facing interface.

Initial tools:

```text
repo_memory.why_file(path)
repo_memory.why_topic(query)
repo_memory.find_decisions(query, path?)
repo_memory.check_regressions(diff)
repo_memory.suggest_missing_tests(diff)
repo_memory.review_with_history(diff)
repo_memory.find_migration_patterns(query, path?)
repo_memory.explain_weird_code(path, selection?)
```

These tools should return structured output with evidence by default.

Example response shape:

```json
{
  "answer": "Middleware avoids DB access because package X broke edge runtime deployment in March.",
  "confidence": 0.91,
  "cards": ["decision-auth-middleware-edge-runtime"],
  "evidence": [
    {"type": "pr", "id": 184, "url": "..."},
    {"type": "commit", "sha": "abc123"},
    {"type": "slack", "channel": "#backend", "thread_ts": "..."}
  ],
  "staleness_risk": "low"
}
```

---

## 11. Repository Artifact Design

The repo should carry its memory metadata without bloating normal Git history.

Recommended layout:

```text
.repo-memory/
  config.yaml
  cards/
    decisions.yaml
    regressions.yaml
    migrations.yaml
    norms.yaml
  evals/
    regression_cases.jsonl
    review_cases.jsonl
    why_questions.jsonl
  schemas/
    decision_card.schema.json
    regression_card.schema.json
  prompts/
    review_with_history.md
    explain_decision.md
  adapter.lock
```

### Commit to Git

- accepted memory cards;
- schemas;
- evals;
- prompts;
- extraction config;
- adapter pointer/checksum.

### Do Not Commit by Default

- raw Slack exports;
- raw Jira dumps;
- unredacted ticket data;
- large model weights;
- large vector indexes;
- sensitive evidence bodies.

### Adapter Lock Example

```yaml
adapter:
  name: repo-review-v3
  base_model: qwen2.5-coder-3b-instruct
  backend: mlx-lm
  sha256: "..."
  artifact: gh-release://org/repo/repo-review-v3
  created_at: 2026-05-12
  dataset_manifest: .repo-memory/evals/review_cases.jsonl
```

---

## 12. Extraction Pipeline

### 12.1 Sources

MVP:

- local Git history;
- commit messages;
- diffs;
- file rename history;
- co-change graph.

V1:

- GitHub PRs;
- PR comments;
- linked issues;
- releases/changelogs.

V2:

- Slack exports;
- Jira/Linear;
- incident docs;
- ADRs;
- wiki/Notion exports.

### 12.2 Extraction Steps

```text
git log parser
  → commit classifier
  → bug-fix / decision / migration / refactor detection
  → PR/issue linker
  → rationale extractor
  → evidence linker
  → card generator
  → validator
  → human review
  → local index + optional dataset
```

### 12.3 Important Signals

- commits containing “fix”, “revert”, “avoid”, “because”, “remove”, “replace”, “migrate”, “deprecate”;
- commits that close issues;
- PR comments with explicit rationale;
- Slack threads linked near PR creation time;
- large repeated diffs indicating migration;
- bug-fix commits followed by new tests;
- recurring review comments;
- files frequently changed together;
- reverted commits;
- incident references.

---

## 13. Validation Pipeline

Validation is a first-class product feature.

### 13.1 Checks

- evidence exists;
- evidence supports claim;
- referenced files still exist or are marked historical;
- referenced dependency still exists or decision is marked stale;
- duplicate card detection;
- contradiction detection;
- train/eval leakage prevention;
- confidence scoring;
- PII/sensitive data detection;
- human spot-check workflow.

### 13.2 Card Statuses

```text
active
superseded
deprecated
conflicting
unknown
rejected
```

### 13.3 Human Review CLI

```bash
repo-arch review-cards
repo-arch accept decision-auth-middleware-edge-runtime
repo-arch reject decision-old-webpack-hack
repo-arch mark-superseded decision-old-auth decision-new-auth
```

---

## 14. Dataset Generation

Training datasets should be generated from validated cards, not raw history.

Correct flow:

```text
raw GitHub/Slack/Git history
  → extracted cards
  → validated cards
  → synthetic task examples from cards
  → train/eval split
  → optional fine-tune
```

### 14.1 Dataset Families

From one decision card, generate:

#### Decision QA

```json
{
  "messages": [
    {"role": "user", "content": "Why doesn't our middleware call the database directly?"},
    {"role": "assistant", "content": "Because the team previously removed DB access from middleware after edge runtime deployment failures. Evidence: PR #184, commit abc123."}
  ]
}
```

#### Review Warning

```json
{
  "messages": [
    {"role": "user", "content": "Review this diff:\n+ import { db } from '@/db/client'\n+ export function middleware(req) { return db.user.find(...) }"},
    {"role": "assistant", "content": "Risk: this reintroduces the old middleware edge-runtime failure. Avoid DB access in middleware; use token-only validation here. Evidence: PR #184, commit abc123."}
  ]
}
```

#### Structured Risk Classification

```json
{
  "input": "diff touching src/middleware.ts with package X import",
  "output": {
    "risk": "edge_runtime_regression",
    "severity": "high",
    "evidence_required": true,
    "evidence": ["PR #184", "commit abc123"]
  }
}
```

#### Negative Examples

Negative examples are mandatory to prevent over-flagging.

```json
{
  "input": "diff touching src/auth/server.ts with DB-backed auth check",
  "output": {
    "risk": "none",
    "reason": "DB-backed checks are allowed in server routes; the middleware restriction does not apply here."
  }
}
```

---

## 15. Training Backends

Training is optional in MVP and should arrive after extraction quality is proven.

### 15.1 Recommended Backends

Primary Mac backend:

```text
mlx-lm
```

Experimental Mac backend:

```text
mlx-tune
```

NVIDIA/cloud backend:

```text
Unsloth
```

Inference targets:

```text
MLX
llama.cpp / GGUF
Ollama
LM Studio
local MCP server
```

### 15.2 Target Model Sizes

Start with:

```text
1.5B–4B for classifiers, review reflexes, answer style
7B–8B only after dataset/eval quality is proven
```

Do not start with 27B+.

### 15.3 What the Adapter Learns

The adapter should learn:

- concise project-specific explanation style;
- how to apply retrieved decision cards;
- how to classify diff risk;
- how to generate review comments;
- how to say “not enough evidence”;
- how to use evidence links without hallucinating them.

The adapter should not be trusted as the source of factual truth.

---

## 16. MVP Definition

### MVP Goal

Validate whether automatically extracted project memory is true and useful.

### MVP Scope

Build only:

```bash
repo-arch mine
repo-arch cards
repo-arch why <path-or-topic>
repo-arch check-diff
```

No fine-tuning required. No full MCP required if time-constrained, but MCP should be designed early.

### MVP Input

- local Git repo;
- optional GitHub token for PR/issue data.

### MVP Output

- 30–100 candidate memory cards;
- terminal preview;
- local JSON/YAML card files;
- evidence links;
- confidence/staleness labels.

### MVP Success Test

Show the extracted cards to a senior engineer familiar with the project.

Pass condition:

> They say: “Yes, these are accurate and useful. I remember these decisions.”

If this fails, training and MCP do not matter.

---

## 17. V1 Definition

Add:

- GitHub PR/comment ingestion;
- local SQLite/card index;
- `repo-arch install-mcp`;
- MCP tools for `why_file`, `find_decisions`, `check_regressions`;
- card review CLI;
- staleness and contradiction checks;
- evidence-first answer format.

---

## 18. V2 Definition

Add:

- Slack export ingestion;
- Jira/Linear ingestion;
- migration-pattern extraction;
- missing-tests suggestions from co-change history;
- dataset generation from cards;
- eval generation;
- optional MLX fine-tuning;
- adapter lockfile and artifact packaging.

---

## 19. V3 Definition

Add:

- hosted optional dashboard for teams;
- scheduled re-mining;
- quarterly retraining;
- CI integration;
- private artifact registry;
- multi-repo organization memory;
- team-level policy and permission controls.

---

## 20. Metrics

### Extraction Quality

- % cards accepted by human reviewer;
- average evidence count per card;
- contradiction rate;
- stale card rate;
- duplicate rate;
- unsupported claim rate.

### Product Value

- time to answer “why” questions;
- number of useful historical decisions found;
- number of regression warnings accepted;
- new-hire onboarding satisfaction;
- reduction in repeated senior-engineer questions.

### Agent Utility

- tool call success rate;
- evidence citation presence;
- hallucinated evidence rate;
- diff warnings marked useful;
- false-positive regression warnings.

### Fine-Tuning Value

Compare:

```text
base model + prompt
vs
RAG-only repo memory
vs
RAG + fine-tuned adapter
```

Track:

- win rate by judge/human;
- JSON/schema validity;
- latency;
- token cost;
- false-positive warning rate;
- evidence misuse rate.

---

## 21. Security and Privacy

Repo-Arch touches sensitive engineering history. Trust is mandatory.

### Requirements

- local-first by default;
- raw Slack/Jira exports never committed by default;
- explicit file/source scopes;
- redaction before external teacher model calls;
- audit log of extracted cards and evidence;
- option to run without external APIs;
- allowlist for shell/GitHub/Slack access;
- clear distinction between public, private, and local-only evidence;
- no automatic committing of generated memory cards without user approval.

### Slack Handling

Slack is high-value but sensitive.

Default policy:

```text
raw Slack stays local
summaries/cards require review before commit
thread pointers are private unless explicitly exported
```

---

## 22. Virality Strategy

Virality is important for a developer/open-source tool, but it should come from a concrete “aha” moment, not hype.

### Viral Moment

```bash
repo-arch why src/auth/middleware.ts
```

Answer:

```text
This file avoids DB/client access because middleware previously failed in edge runtime when package X was imported here.

Current rule:
- middleware: token-only validation
- server routes/actions: DB-backed auth checks

Evidence:
- PR #184: removed DB access from middleware
- commit abc123: replaced package X usage
- Slack #backend thread, 2026-03-14
```

This is something a generic model will not know unless it re-digs the project history.

### Distribution Loop

1. Developer runs Repo-Arch on a repo.
2. It extracts surprising true decisions.
3. Developer commits `.repo-memory/` or shares screenshot.
4. New hires / teammates use it.
5. Agents call it through MCP.
6. Other teams want the same for their repos.

### Screenshotable Output

```text
✅ Repo memory mined
Cards generated: 74
Accepted after validation: 51
Decision cards: 22
Regression cards: 11
Migration cards: 7
Norm cards: 11
Evidence-backed cards: 96%
Potentially stale: 4
MCP tools installed: 5
```

---

## 23. Competitive Positioning

### Compared to Claude/Codex/Cursor

Those are general reasoning/coding systems. Repo-Arch gives them local project memory and evidence.

### Compared to RAG over docs

Docs say what is intended. Git/PR/Slack history reveals what actually happened and why.

### Compared to “chat with your repo”

Repo-Arch focuses on historical rationale, regressions, decisions, migrations, and team scars, not generic Q&A.

### Compared to fine-tuning services

Fine-tuning is an optional step. The core product is extracting validated memory from project history.

---

## 24. Key Risks

### Risk: Extracted cards are inaccurate

Mitigation:

- evidence-first design;
- confidence scoring;
- human review;
- no unsupported cards promoted to active status.

### Risk: Cards become stale

Mitigation:

- staleness checks;
- superseded statuses;
- scheduled re-mining;
- file/dependency existence checks.

### Risk: Too noisy / too many warnings

Mitigation:

- negative examples;
- severity thresholds;
- user feedback loop;
- conservative default output.

### Risk: Privacy concerns block adoption

Mitigation:

- local-first;
- source scopes;
- redaction;
- no raw Slack commits;
- audit log.

### Risk: Training distracts from product value

Mitigation:

- MVP ships without training;
- fine-tune only after RAG/card value is proven;
- eval must prove adapter beats baseline.

---

## 25. Open Questions

1. Should the first public version use `repo-arch`, `strata`, or `essence` naming?
2. Should GitHub API support be required in MVP, or should local Git-only come first?
3. How much human review is necessary before cards are safe to commit?
4. What is the best local index format: SQLite, LanceDB, JSONL + embeddings, or hybrid?
5. How should Slack evidence be represented without exposing private content?
6. Should adapters be committed via Git LFS, GitHub Releases, or external artifact stores?
7. Which first model should be the default for MLX LoRA experiments?
8. What is the minimum useful MCP tool set for launch?

---

## 26. Recommended Build Order

### Week 1: Prove Extraction

- local Git parser;
- commit classifier;
- first decision/regression card generator;
- terminal card preview;
- `repo-arch why <file>` using generated cards.

### Week 2: Add GitHub Context

- PR ingestion;
- issue ingestion;
- evidence linking;
- confidence scoring;
- card review CLI.

### Week 3: Agent Interface

- local SQLite/card index;
- MCP server;
- `why_file`, `find_decisions`, `check_regressions` tools.

### Week 4: Dataset and Training Prototype

- dataset generation from accepted cards;
- eval split;
- MLX LoRA training on 1.5B–4B model;
- compare RAG-only vs RAG + adapter.

---

## 27. Final Product Statement

Repo-Arch turns project history into local agent memory.

It mines Git history, PRs, issues, and Slack traces into validated decision, regression, migration, and norm cards. Those cards are evidence-backed, reviewable, versionable, and exposed as MCP tools for AI coding agents.

Optional fine-tuning compiles the project’s review instincts and decision grammar into a small repo-specific adapter, but the source of truth remains the validated memory layer.

The strongest wedge is not “better code assistance.” It is:

> project archaeology turned into local agent tools.

