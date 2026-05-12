# Repo-Arch Roadmap

This roadmap tracks the implemented baseline, the next product slices, and when to introduce embeddings from the appendix. Keep this file updated when a PR materially changes project direction or phase status.

## Current Baseline

Implemented on `main`:

1. **Git history mining**
   - `repo-arch mine-history`
   - Extracts commit SHA, parents, author, timestamp, subject, and changed files into JSONL.
   - Caches raw history by repo path + HEAD.

2. **Commit signal classification**
   - `repo-arch classify`
   - Deterministic signal detection for fix, revert, rationale, migration, refactor, docs, test, perf, security, config, and experimental commits.

3. **Insight cards**
   - `repo-arch cards`
   - Generates ranked cards for churn hotspots, repeated fix areas, rationale clusters, test gaps, reversion patterns, and co-change clusters.
   - Cards are cached by HEAD in `.repo-arch/cache/cards/`.

4. **File explanation**
   - `repo-arch why <file>`
   - Produces a file-level historical dossier: commit count, signals, fixes, rationale, reverts, co-changes, and related cards.

5. **Diff warnings**
   - `repo-arch check-diff --base <ref> --head <ref>`
   - Produces non-blocking warnings from historical patterns: repeated fixes, reverts, test gaps, and co-change reminders.

6. **Project hygiene**
   - TypeScript-first codebase.
   - GitHub Actions CI runs typecheck + tests.
   - `main` is protected; changes land through PRs with CI required and zero approval requirement.

## Guiding Product Loop

The current loop is:

```text
git history
  -> structured history records
  -> deterministic commit signals
  -> insight cards
  -> file explanations
  -> diff warnings
```

The next phases should make this loop more trustworthy, reviewable, and useful before expanding into GitHub/Slack ingestion or fine-tuning.

## Phase 1: Stabilize Local Git Memory

Goal: make local-only Repo-Arch useful on real repositories without external APIs.

Next likely work:

- Improve cache boundaries and invalidation beyond HEAD-level cards.
- Add stable card IDs and card metadata (`created_at`, `source_head`, `status`).
- Add deterministic staleness validation:
  - referenced files still exist;
  - repeated-fix/test-gap cards still touch active paths;
  - deleted/renamed files are marked historical.
- Add card review state:
  - accepted;
  - rejected;
  - needs_review;
  - superseded;
  - stale.
- Add a compact report command for humans:
  - top cards;
  - unresolved risk areas;
  - cache status;
  - suggested next actions.

Exit criteria:

- Running Repo-Arch on several local repos surfaces useful cards with low obvious-noise.
- A user can accept/reject cards and rerun without losing review state.
- `check-diff` warnings are explainable and tied to card/history evidence.

## Phase 2: Add Embedding Retrieval and Similarity

Goal: add the embedding layer from [EMBEDDINGS_APPENDIX.md](./EMBEDDINGS_APPENDIX.md) after the structured-card loop is stable.

Scope:

- Build a local card/summarized-history index.
- Prefer a local, inspectable store such as SQLite + sqlite-vec if practical.
- Embed generated cards and compact summaries, not raw giant diffs.
- Add semantic retrieval to supplement deterministic lookup:
  - path-scoped cards first;
  - embedding search over cards second;
  - raw evidence fallback only when needed.
- Add `repo-arch similar --diff HEAD` for similar past changes.
- Use embeddings for dedupe and evidence-link suggestions, not as the source of truth.

Exit criteria:

- `why <file>` and `check-diff` can retrieve relevant cards even when wording differs.
- Similar-history search finds useful past commits/cards beyond exact path matching.
- Embedding index is local-first and safely ignored/cleaned by default unless explicitly committed.

## Phase 3: Validation and Review Workflow

Goal: turn generated cards into reviewable, durable project memory.

Scope:

- Card schema files for decision/regression/migration/norm cards.
- Review CLI:
  - `repo-arch review-cards`;
  - `repo-arch accept <card-id>`;
  - `repo-arch reject <card-id>`;
  - `repo-arch mark-stale <card-id>`;
  - `repo-arch mark-superseded <old-id> <new-id>`.
- Confidence and staleness scoring.
- Duplicate and contradiction checks.
- Optional export to `.repo-memory/cards/` for committed, reviewed project memory.

Exit criteria:

- Accepted cards can be versioned safely.
- Rejected/noisy cards stop reappearing without explanation.
- Stale/superseded decisions are visible in `why` and `check-diff` output.

## Phase 4: GitHub Context

Goal: enrich local git signals with PR/issue evidence.

Scope:

- GitHub PR ingestion.
- Issue ingestion and PR/commit linkage.
- Review comment summaries.
- Evidence links in cards and `why` output.
- Local cache for fetched metadata.

Exit criteria:

- Cards cite PRs/issues when available.
- `why <file>` can explain rationale from PR descriptions/review comments, not only commit subjects.

## Phase 5: Agent Interface

Goal: expose Repo-Arch memory to coding agents.

Scope:

- MCP server.
- Initial tools:
  - `repo_memory.why_file(path)`;
  - `repo_memory.find_decisions(query, path?)`;
  - `repo_memory.check_regressions(diff)`;
  - `repo_memory.review_with_history(diff)`.
- Structured outputs with evidence and confidence.

Exit criteria:

- Agents can call Repo-Arch without scraping terminal output.
- Tool responses cite cards/evidence and distinguish accepted vs generated memory.

## Phase 6: Evaluation and Optional Fine-Tuning

Goal: measure value and only then consider adapter training.

Scope:

- Eval fixtures from accepted cards.
- Compare baseline prompt vs structured lookup vs embedding retrieval.
- Optional MLX/LoRA adapter after retrieval/card quality is proven.

Exit criteria:

- Fine-tuning is justified by eval wins, not assumed useful.
- Adapter never becomes the sole source of factual evidence.

## Embeddings Timing

Embeddings are important, but they should enter after the local structured-card loop is usable. The appendix position is:

```text
Embeddings find the memories.
Cards certify the memories.
RAG cites the memories.
Adapters internalize the habits.
MCP exposes the memories to agents.
```

That means embeddings are Phase 2 connective tissue, not Phase 0 product foundation.
