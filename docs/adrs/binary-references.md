---
status: accepted
---

# Binary references and per-vault storage

## Context and Problem Statement

Embedding attachment bytes inside CRDT documents duplicates content and makes metadata expensive to fetch and compact. A Git blob hash identifies exact bytes, but by itself cannot express the causality needed to resolve competing replacements.

## Considered Options

- Embed attachment bytes in CRDT documents
- Store Git blob references in CRDT state

## Decision Outcome

Chosen option: Store Git blob references in CRDT state, because this avoids duplicating attachment bytes while retaining causality for concurrent replacements.

Store binary references in CRDT state and keep the bytes as ordinary Git objects. Resolve references through ordinary repository files first. Retain content separately only when sync state still needs it and no ordinary file supplies it.

Group state under `.gitbin/vaults/<vault>/`, with notes and attachments separated there. Do not introduce a parallel top-level blob-per-vault hierarchy. Consolidation rebuilds compact CRDT documents while preserving stable file identities and removes obsolete deleted state and retained content.

### Consequences

CRDT metadata still resolves concurrent binary replacements even after consolidation; the blob hash is a content address, not a replacement for that metadata. Publication must preserve every still-referenced object. Git and host retention determine physical storage reclamation, so a compact logical snapshot does not promise immediate disk savings.

## More Information

### References

- [Git objects](https://git-scm.com/book/en/v2/Git-Internals-Git-Objects)
- [Yjs documentation](https://docs.yjs.dev/)
