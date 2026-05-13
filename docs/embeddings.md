# Embeddings

Embeddings help Repo-Arch find the right memory, but they do not replace the cards.

## Use them for

- semantic retrieval
- similar past changes
- deduplication
- drift and staleness signals
- evidence linking

## Keep them secondary

- cards remain the source of truth
- validation comes before serving
- local storage should stay inspectable
- raw history should not become the only index

## Practical rule

Add embeddings after the structured card loop is useful.
