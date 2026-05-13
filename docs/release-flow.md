# Release Flow

This repo should release like the rest of the fiale-plus CLI tools: small PRs, clean `main`, and a short path from merge to publish.

## Flow

1. Branch from the latest `main`.
2. Keep the change small and docs-aligned.
3. Run `npm run typecheck` and `npm test`.
4. Open a PR with a focused scope.
5. Merge only after CI is green.
6. Stack the next PR on the new `main`.
7. Tag and publish when a release is needed.

## What to keep in sync

- README quickstart
- usage docs
- roadmap status
- release notes / changelog
- stable CLI output

## Rule of thumb

If the change affects the CLI, the docs should move with it in the same PR.
