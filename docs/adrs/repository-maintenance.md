---
status: accepted
---

# Shared repository maintenance and recovery

## Context and Problem Statement

Users need both a way to discard accumulated history and a way to repair damaged metadata. Rebuilding from the current device could accidentally replace committed repository content or consume pending local edits.

## Considered Options

- Rebuild metadata from files currently on the device
- Rebuild metadata from committed repository files

## Decision Outcome

Chosen option: Rebuild metadata from committed repository files, because repair must preserve the committed snapshot and leave pending local edits for the next sync.

Consolidate migrates and compacts the latest committed snapshot. Reinitialize rebuilds `.gitbin` metadata from committed files for known vaults, including vaults discoverable from damaged metadata. Both publish through the same protected history-replacement pipeline. Neither uses the current device's files as the replacement repository snapshot.

Show a shared warning and acknowledgement checklist. Start preparation only after final confirmation, then show progress. Replace `main` with one root commit, checking the expected remote revision before Git's compare-and-swap update. Record a durable recovery checkpoint around publication; block normal sync until an interrupted operation is reconciled.

### Consequences

These are repository-wide destructive history operations, not routine sync. Branch protection can reject them. Other branches and tags remain unchanged. Pending device edits are preserved for later replay, with unreconcilable changes preserved separately. A damaged device journal is a separate recovery problem and must not be silently discarded. Opening the modal requires no network preparation.

## More Information

### References

- [Git push and force-with-lease](https://git-scm.com/docs/git-push)
- [Git garbage collection](https://git-scm.com/docs/git-gc)
