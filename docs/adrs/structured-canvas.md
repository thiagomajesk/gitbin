---
status: accepted
---

# Structured Canvas merging

## Context and Problem Statement

Treating an entire Canvas JSON document as one atomic value loses independent edits to different cards and connections. Users should keep using native Canvas files and the native editor.

## Considered Options

- Resolve the entire Canvas document as one atomic value
- Merge Canvas cards, text, properties, and connections independently

## Decision Outcome

Chosen option: Merge Canvas cards, text, properties, and connections independently, because edits to separate elements should survive concurrent work in the native editor.

Represent cards and connections by stable IDs with independently mergeable properties. Use collaborative text for text-card content and explicit ordered IDs for stacking. Deletion takes precedence over concurrent edits; edges pointing to deleted cards disappear. Preserve unknown properties and original JSON bytes when the document is unchanged.

Reject invalid Canvas data without overwriting valid remote content. Introduce the representation through the descriptive `structured-canvas` migration, using the existing explicit consolidation path and device baseline replay. Reuse on-demand availability handling rather than add a separate Canvas downloader.

### Consequences

Independent edits can merge, but the engine must preserve JSON Canvas invariants and deterministic ordering. Concurrent edits to the same scalar property still need deterministic conflict resolution. Migration must preserve local edits that have not yet been captured. Accepted design and local tests do not imply a published release or physical mobile validation.

## More Information

### References

- [JSON Canvas specification](https://jsoncanvas.org/spec/1.0/)
- [Yjs shared types](https://docs.yjs.dev/api/shared-types)
