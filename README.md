# Repo-Arch

Turn project history into local agent memory.

Repo-Arch is a product concept for mining Git history, GitHub PRs, issues, Slack traces, and related engineering artifacts into validated memory cards that humans and AI coding agents can query locally through a CLI and MCP tools.

## Why

Modern coding agents can inspect the current codebase, but they are usually blind to the historical context that explains why code is shaped the way it is: past regressions, rejected alternatives, migration scars, and team-specific engineering norms.

Repo-Arch turns that scattered history into evidence-backed, reviewable, versionable memory.

## Core primitive: memory cards

Repo-Arch centers on validated memory cards:

- **Decision cards**: why an architecture or implementation choice exists.
- **Regression cards**: bugs or failure patterns that should not be reintroduced.
- **Migration cards**: old and new patterns, including why the migration happened.
- **Norm cards**: team review expectations and recurring engineering practices.

Cards are designed to be inspectable by humans, linked to evidence, stored locally, and served to agents.

## Current MVP

The first implementation slice is local git-history mining, implemented in TypeScript from day one:

```bash
repo-arch mine-history --repo . --out history.jsonl
```

It extracts commit SHA, parents, author, timestamp, subject, and changed files into stable JSONL, with a small cache keyed by repo path + HEAD.

## Intended product surface

MVP CLI shape:

```bash
repo-arch mine-history --repo <path> --out <file>
repo-arch mine
```

Planned agent interface:

```text
repo_memory.why_file(path)
repo_memory.why_topic(query)
repo_memory.find_decisions(query, path?)
repo_memory.check_regressions(diff)
repo_memory.review_with_history(diff)
```

## Local-first by default

Repo-Arch is intended for sensitive engineering history. Raw Slack/Jira exports, unredacted ticket data, large vector indexes, and model weights should stay local unless explicitly exported.

## Status

This repository currently contains the initial PRD and the first git-history mining slice. See [PRD.md](./PRD.md) for the full product requirements document.

## License

MIT © fiale-plus
