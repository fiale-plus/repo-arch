---
name: repo-arch
description: Self-contained repo-arch workflow for turning git history into cards, embeddings, datasets, and training runs. Use when you want the CLI flow, run inspection, or guided repo-memory setup.
---

# Repo-Arch

## Quick start

```bash
repo-arch init
repo-arch flow run --repo .
repo-arch flow run full --repo .
repo-arch flow inspect --repo .
```

## Core workflow

1. `repo-arch init` — write a starter `repo-arch.config.json`
2. `repo-arch flow run` — build history, cards, dataset, and train plan
3. `repo-arch flow run full` — also build embeddings and evaluation
4. `repo-arch flow inspect` — see run status, artifacts, and next steps
5. `repo-arch review list` — curate accepted/rejected cards
6. `repo-arch eval` — compare retrieval strategies
7. `repo-arch train prepare` — export training plan
8. `repo-arch train cycle` — continue the persistent training loop
9. `repo-arch train resume` — resume from the latest checkpoint
10. `repo-arch train run` — execute training directly

## Investigation commands

```bash
repo-arch why src/core.ts --json
repo-arch check-diff --base main --json
repo-arch check-stale --json
repo-arch similar "why auth middleware token-only?" --json
```

## What to suggest next

- First-time user: `repo-arch init`
- Want the happy path: `repo-arch flow run full`
- Need run details: `repo-arch flow inspect`
- Need curation: `repo-arch review list`
- Need training: `repo-arch train cycle`
- Need to resume: `repo-arch train resume`
- Need status: `repo-arch train status`
- Need the history: `repo-arch train list`

Keep the CLI as the source of truth; use this skill only as a guide to the flow.
