# Repo-Arch Vision

Repo-Arch turns repository history into local memory that humans and agents can trust.

## Principles

- CLI-first: the command line is the primary interface.
- Local-first: keep data and evidence in the repo or local cache.
- Evidence-backed: cards must point to real history.
- Stable output: JSON should stay predictable for automation.
- Small PRs: stack work on top of the latest `main`.

## Today

Repo-Arch already covers history mining, signal classification, cards, `why`, diff warnings, staleness checks, similarity search, evals, datasets, and training prep.

The stable user entrypoint is now the flow contract:

- `repo-arch init`
- `repo-arch flow run`
- `repo-arch flow inspect`

## Not the focus

- not a generic chat UI
- not a cloud-hosted product by default

## Later

If adapters or agent integrations are added later, they should wrap the CLI flow and preserve the same artifact contract.
