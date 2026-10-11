---
status: accepted
---

# Explicit migrations through consolidation

## Context and Problem Statement

New releases need to change stored data without accumulating legacy readers in normal sync. Automatic migration would also let users encounter incompatible older revisions if history were left untouched. Numeric format versions do not explain which transformations were applied.

## Considered Options

- Apply migrations automatically during sync
- Keep runtime compatibility with older data
- Apply migrations through explicit consolidation

## Decision Outcome

Chosen option: Apply migrations through explicit consolidation, because users must approve history replacement and normal sync should only handle current data.

Validate normal sync data against the current schemas and migration registry. Store repository compatibility information in one `.gitbin/metadata.json` containing descriptive `appliedMigrations` and a `consolidationHash`; device journals carry corresponding metadata. Do not add a separate metadata version counter.

Run migrations only inside user-confirmed consolidation, before publishing its replacement history. Pending migrations pause sync. Migration code may read legacy data; normal sync has no compatibility bridge. Unknown, reordered, or inconsistent applied IDs are rejected rather than guessed.

Each migration implements the strict `StorageMigration` interface: stable ID, title, and Effect-based `inspect`, `transform`, and `validate`. Unapplied steps inspect isolated snapshots and report `needed`, `satisfied`, or `blocked`. Satisfied steps skip transformation but must still validate before being recorded. Applied steps are skipped according to the validated registry prefix; final current-data validation still runs.

### Consequences

Users explicitly approve history replacement when upgrading stored data. Migration functions cannot publish or mutate live state. There is no separately published migration branch. All devices must update; an older local journal can require consolidation on that device too, preserving its pending edits. The consolidation hash identifies a reset of sync state and triggers checkpoint-based replay rather than merging obsolete CRDT state.
