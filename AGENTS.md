# Agent Notes

Read this first:

- README.md
- PRD.md
- ROADMAP.md

Load on demand only when the task needs it:

- docs/vision.md — architecture and product direction
- docs/usage.md — CLI usage and stable output
- docs/release-flow.md — release process
- docs/roadmap.md — current status and next work
- docs/embeddings.md — retrieval and training notes

## Rules

- CLI-first, local-first
- do not preload all docs
- keep adapters optional and later
- stack small PRs on the latest `main`
- update the roadmap when status changes
- run `npm run typecheck` and `npm test` before PRs
- keep docs short and aligned with the code
