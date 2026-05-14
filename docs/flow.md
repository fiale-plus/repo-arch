# Flow

Repo-Arch works best as a self-contained flow.

## Happy path

```bash
repo-arch init
repo-arch flow run --repo .
repo-arch flow run full --repo .
repo-arch flow inspect --repo .
repo-arch train prepare --repo .
repo-arch train cycle --repo .
repo-arch train resume --repo .
repo-arch train status --repo .
repo-arch train list --repo .
repo-arch train run --repo .
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
- `training/session.json` — persistent training status
- `training/cycles.jsonl` — cycle history and checkpoints
- `index.json` — embeddings metadata when `flow run full` is used
- `eval.json` — retrieval metrics when `flow run full` is used

## Train later

```bash
repo-arch train prepare --repo .
repo-arch train cycle --repo .
repo-arch train resume --repo .
repo-arch train run --repo .
```

## Notes for agents

- Prefer `flow run` and `flow inspect` over internal file paths.
- Use `review list` before training to reduce noisy cards.
- Use `train cycle` to continue a persistent training loop.
- Use `train status` and `train list` to inspect progress.
- Keep `repo-arch.config.json` in the repo root for stable defaults.
