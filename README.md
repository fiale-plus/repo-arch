# Repo-Arch

[![npm version](https://img.shields.io/npm/v/@fiale-plus/repo-arch.svg)](https://www.npmjs.com/package/@fiale-plus/repo-arch)
[![npm downloads](https://img.shields.io/npm/dm/@fiale-plus/repo-arch.svg)](https://www.npmjs.com/package/@fiale-plus/repo-arch)
[![CI](https://github.com/fiale-plus/repo-arch/actions/workflows/ci.yml/badge.svg)](https://github.com/fiale-plus/repo-arch/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Local project-memory engine for git history.

## Quickstart

```bash
npm install -g @fiale-plus/repo-arch

cd your-project

repo-arch init                  # write starter config
repo-arch flow run --repo .     # mine history → cards → dataset
repo-arch flow inspect --repo . # see what was produced
```

Then curate and train:

```bash
repo-arch review list           # review generated cards
repo-arch accept <card-id>      # mark valuable cards
repo-arch train run --repo .    # fine-tune on accepted cards
```

Requires Node 18+ and (for training) Apple Silicon with MLX.

Repo-Arch mines repository history, classifies commit signals, builds cards, explains files, warns on diffs, checks staleness, runs similarity search, prepares evals, and generates training data.

## Pi install

```bash
pi install npm:@fiale-plus/repo-arch
pi install git:github.com/fiale-plus/repo-arch
pi -e git:github.com/fiale-plus/repo-arch   # try without installing
```

The package exposes a thin pi skill + extension bridge, but `repo-arch` CLI remains the source of truth.

## CLI-first

```bash
repo-arch init
repo-arch flow run --repo .
repo-arch flow run full --repo .
repo-arch flow inspect --repo .
repo-arch review list
repo-arch eval
repo-arch dataset
repo-arch train cycle --repo .
repo-arch train resume --repo .
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
