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
repo-arch init
repo-arch flow run --repo .
repo-arch flow run full --repo .
repo-arch flow inspect --repo .
repo-arch review list
repo-arch eval
repo-arch dataset
repo-arch train run --repo .
```

## Docs

- [docs/flow.md](./docs/flow.md)
- [docs/vision.md](./docs/vision.md)
- [docs/usage.md](./docs/usage.md)
- [docs/release-flow.md](./docs/release-flow.md)
- [docs/roadmap.md](./docs/roadmap.md)
- [docs/embeddings.md](./docs/embeddings.md)

CLI is the primary interface. The `pi` skill and extension are thin guides over the same contract.
