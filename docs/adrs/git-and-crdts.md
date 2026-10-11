---
status: accepted
---

# Git publication and CRDT merging

## Context and Problem Statement

Devices must edit offline and later converge through a Git host. A repository can contain multiple vaults. The agreed model has one authoritative `main`, rather than persistent branches for each device, and keeps sync metadata separate from ordinary vault contents.

## Considered Options

- Keep persistent device branches
- Publish merged CRDT state through one authoritative main branch

## Decision Outcome

Chosen option: Publish merged CRDT state through one authoritative main branch, because devices need a shared source of truth while CRDTs resolve concurrent content changes.

Use Yjs CRDT state to resolve concurrent content changes and Git to publish the resulting snapshot. Fetch remote state, combine it with pending local changes, materialize ordinary files, and publish to `main`. If another device advances the branch, retry against the new remote state; normal sync never force-pushes.

Keep vaults in separate folders identified by their local names. Store control data under repository-level `.gitbin`. Early planning called this directory `.metadata`; the implemented name is `.gitbin`.

### Consequences

Git history contains readable files, while metadata retains the information required for automatic merging. Binary replacements resolve atomically rather than merging their bytes. Devices need durable local checkpoints and pending changes; optional UI history is not that checkpoint. Matching vault names are part of setup, and a repository may contain other vaults that the current Obsidian instance does not open.

## More Information

### References

- [Yjs documentation](https://docs.yjs.dev/)
- [Git push](https://git-scm.com/docs/git-push)
