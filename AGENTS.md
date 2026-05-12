# Agent Instructions for Repo-Arch

This project builds local, evidence-backed project memory from repository history. Agents working here should preserve the small-PR, test-first, TypeScript-first workflow.

## Always Load Project Context

Before substantial work, read:

1. [README.md](./README.md) — current product surface and usage.
2. [PRD.md](./PRD.md) — full product requirements and long-term thesis.
3. [ROADMAP.md](./ROADMAP.md) — implemented baseline and next phases.
4. [EMBEDDINGS_APPENDIX.md](./EMBEDDINGS_APPENDIX.md) — embedding strategy and when to introduce it.

Treat `ROADMAP.md` as the active work tracker. Update it when a PR changes phase status, adds/removes a planned capability, or changes sequencing.

## Current Development Rules

- TypeScript only for implementation.
- Keep features small and PR-sized.
- Prefer deterministic local analysis before adding LLMs or embeddings.
- No direct pushes to `main`; work on branches and open PRs.
- CI must pass before merge.
- Use tests to control regressions; add tests for each new behavior.

## Product Architecture Principles

- Structured memory cards are the core artifact.
- Evidence and validation matter more than model cleverness.
- Embeddings are connective tissue, not the product moat.
- Fine-tuning is optional and should come after extraction, cards, retrieval, and evals are useful.
- Local-first behavior is the default; do not commit private raw Slack/Jira exports or large generated indexes by default.

## Current Implemented Loop

```text
git history
  -> mine-history
  -> classify
  -> cards
  -> why <file>
  -> check-diff
```

## Preferred Next-Step Order

Follow `ROADMAP.md`, currently:

1. Stabilize local git memory: stable card IDs, validation, review state.
2. Add embeddings after the structured-card loop is useful.
3. Add GitHub PR/issue context.
4. Expose MCP tools.
5. Add evals and only then optional fine-tuning.

## Regression Discipline

Before opening a PR, run:

```bash
npm run typecheck
npm test
```

If output grows large, summarize it rather than pasting logs. CI repeats these checks on GitHub.
