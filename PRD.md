# Repo-Arch Vision

Repo-Arch is a local memory engine for repositories.

It keeps a stable CLI contract and JSON output so any harness can consume it. The core loop is:

```text
git history -> signals -> cards -> explanations -> warnings -> retrieval -> evals -> training data
```

## What it is

- CLI-first
- local-first
- evidence-backed
- reviewable and versionable

## What it is not

- adapter-first
- a generic chatbot
- a cloud service
- a replacement for the codebase itself

## Current surface

- `mine-history`
- `classify`
- `cards`
- `why <file>`
- `check-diff`
- `check-stale`
- `index`
- `similar`
- `eval`
- `dataset`
- `train`

## Next

- release flow docs and automation
- GitHub PR/issue context
- optional adapters later

See [docs/vision.md](./docs/vision.md) and [docs/roadmap.md](./docs/roadmap.md).
