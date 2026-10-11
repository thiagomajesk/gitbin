---
status: accepted
---

# Verification of supported production decisions

## Context and Problem Statement

Tests sample executions. Small deterministic decisions about ordering, compatibility, and limits also benefit from machine-checked contracts. Verification should cover all supported production logic, not an arbitrary pilot of a few functions, without claiming that async integration has been proved.

## Considered Options

- Verify only an initial selection of functions
- Verify all supported production logic and test unsupported boundaries

## Decision Outcome

Chosen option: Verify all supported production logic and test unsupported boundaries, because verification coverage should follow tool capabilities rather than an arbitrary function count.

Use LemmaScript with the pinned Dafny backend for supported production functions. Keep contracts beside their implementation and check generated artifacts. Discover contracts automatically, track reviewed production source in a coverage manifest, and require concrete reasons for unsupported areas. Include proof verification, coverage review, and negative mutation checks in the quality gate.

### Consequences

The backend is Dafny, not Lean. Verification establishes the written contracts under the tool's supported semantics and assumptions; it does not prove Git networking, Effect scheduling, Yjs internals, or Obsidian behavior. Those boundaries still need tests and real integration checks. Changes to reviewed source require review even if no existing contract changed. Do not weaken contracts, insert unchecked assumptions, or refresh coverage mechanically to pass the gate.

## More Information

### References

- [LemmaScript](https://lemmascript.org/)
- [Dafny reference manual](https://dafny.org/dafny/DafnyRef/DafnyRef)
