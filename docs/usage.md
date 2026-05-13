# Usage

Repo-Arch is meant to stay boring to script and easy to read.

## Common commands

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

## JSON contract

Use `--json` when another tool will read the output. Keep the shape stable and avoid one-off fields unless they are versioned.

## Working rules

- prefer local evidence over guesses
- keep generated cards reviewable
- cache by repo + HEAD where possible
- do not make release docs depend on adapters
