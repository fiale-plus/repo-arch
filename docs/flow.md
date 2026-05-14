# Flow

Repo-Arch is easiest to use as a self-contained flow.

## Happy path

```bash
repo-arch init
repo-arch flow run --full
repo-arch flow inspect latest
```

## What the flow writes

A run lives under `.repo-arch/runs/<run-id>/` and includes:

- `manifest.json` — versioned run summary
- `history.jsonl` — git history snapshot
- `classified.jsonl` — signal classification
- `cards.jsonl` — insight cards
- `review.json` — card status summary
- `dataset.jsonl` — training examples
- `dataset.json` — dataset summary
- `training/train-plan.json` — LoRA plan
- `.repo-arch/adapters/<name>/` — adapter weights when `--run-train` is used
- `index.json` — embeddings metadata when `--full` is used
- `eval.json` — retrieval metrics when `--full` is used

## Train later

```bash
repo-arch flow run --full --run-train
```

That keeps the CLI reproducible while still allowing the final training step when you are ready.

## Notes for agents

- Prefer `flow run` and `flow inspect` over internal file paths.
- Use `review list` before training to reduce noisy cards.
- Keep `repo-arch.config.json` in the repo root for stable defaults.
