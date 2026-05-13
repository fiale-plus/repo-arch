# Repo-Arch

[![npm version](https://img.shields.io/npm/v/@fiale-plus/repo-arch.svg)](https://www.npmjs.com/package/@fiale-plus/repo-arch)
[![npm downloads](https://img.shields.io/npm/dm/@fiale-plus/repo-arch.svg)](https://www.npmjs.com/package/@fiale-plus/repo-arch)
[![CI](https://github.com/fiale-plus/repo-arch/actions/workflows/ci.yml/badge.svg)](https://github.com/fiale-plus/repo-arch/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Local project-memory engine for git history.

```bash
npm install -g @fiale-plus/repo-arch
```

Repo-Arch mines repository history, classifies commit signals, builds cards, explains files, warns on diffs, checks staleness, runs similarity search, prepares evals, and generates training data.

## CLI-first

```bash
repo-arch mine-history --repo .
repo-arch classify --repo .
repo-arch cards --repo .
repo-arch why src/core.ts --json
repo-arch check-diff --base main --json
repo-arch check-stale --json
repo-arch index
repo-arch similar "why auth middleware token-only?" --json
repo-arch eval
repo-arch dataset
repo-arch train
```

## Docs

- [docs/vision.md](./docs/vision.md)
- [docs/usage.md](./docs/usage.md)
- [docs/release-flow.md](./docs/release-flow.md)
- [docs/roadmap.md](./docs/roadmap.md)
- [docs/embeddings.md](./docs/embeddings.md)

CLI is the primary interface. Optional adapters come later.
