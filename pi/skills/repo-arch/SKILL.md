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
7. `repo-arch dataset` — export training examples from accepted cards
8. `repo-arch train prepare` — export training plan
9. `repo-arch train cycle` — continue the persistent training loop
10. `repo-arch train resume` — resume from the latest checkpoint
11. `repo-arch train run` — execute training directly

## Training workflow details

### Card curation (step 5)

```bash
# See all cards with their 16-char IDs
repo-arch cards --repo .

# Mark valuable cards as accepted
repo-arch accept 55a6c06de1d28481 --repo .

# Mark noisy cards as rejected
repo-arch reject abc123def4567890 --repo .

# Verify curation
repo-arch review list --repo .
```

Card IDs are 16 hex characters. Always copy the full ID from the `repo-arch cards` output.

### Training loop (steps 8-11)

```bash
# Step 1: Prepare training data and plan
repo-arch dataset --repo .
repo-arch train prepare --repo .

# Step 2: Train (runs mlx_lm.lora on Apple Silicon)
repo-arch train run --repo .

# Step 3: Continue training with more cycles
repo-arch train cycle --repo .

# Step 4: Resume from latest checkpoint
repo-arch train resume --repo .

# Monitor convergence
repo-arch train status --repo .
```

### Validating loss convergence

- **Validation loss < 0.3** — Excellent, model has converged well
- **0.3–0.6** — Good, more iterations may help
- **0.6–1.0** — Moderate, consider more data or more iterations
- **> 1.0** — Poor, check training data quality or increase LoRA layers

### Model inference

```bash
# After training, use the adapter for inference
mlx_lm.generate \
  --model Qwen/Qwen2.5-Coder-1.5B-Instruct \
  --adapter-path .repo-arch/adapters/repo-arch-<head-sha>
```

### Adapter checkpoints

Each training cycle saves checkpoints to `.repo-arch/adapters/<adapter-name>/`:
- `adapters.safetensors` — current best weights
- `0000100_adapters.safetensors` — numbered checkpoint (every N iterations)
- `adapter_config.json` — training config (layers, LR, etc.)

To switch to a specific checkpoint, copy the numbered file over `adapters.safetensors`.

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
