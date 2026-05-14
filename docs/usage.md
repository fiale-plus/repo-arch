# Usage

Repo-Arch is meant to stay boring to script and easy to read.

## Command map

### Flow first

```bash
repo-arch init
repo-arch flow run --repo .
repo-arch flow run full --repo .
repo-arch flow inspect --repo .
```

### History and cards

```bash
repo-arch mine-history --repo .
repo-arch classify --repo .
repo-arch cards --repo .
repo-arch cards --invalidate --repo .
repo-arch accept <card-id>
repo-arch reject <card-id>
repo-arch review list
```

### Investigation

```bash
repo-arch why src/core.ts --json
repo-arch check-diff --base main --json
repo-arch check-stale --json
repo-arch similar "why auth middleware token-only?" --json
```

### Retrieval and training

```bash
repo-arch index
repo-arch eval
repo-arch dataset
repo-arch train prepare --repo .
repo-arch train run --repo .
```

## JSON contract

Use `--json` when another tool will read the output. Keep the shape stable and avoid one-off fields unless they are versioned.

## Working rules

- prefer local evidence over guesses
- keep generated cards reviewable
- cache by repo + HEAD where possible
- keep `repo-arch.config.json` in the repo root
- do not make release docs depend on adapters
- keep the CLI contract stable

## Review loop

Use the card review state to tighten training and warnings:

1. generate cards
2. accept the useful ones
3. reject the noisy ones
4. run `repo-arch flow run full --repo .` again
5. inspect the latest run and retrain when ready
