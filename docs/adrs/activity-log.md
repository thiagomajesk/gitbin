---
status: accepted
---

# Application events as the activity log

## Context and Problem Statement

Users need to understand sync failures without reading developer-console output. A separate elaborate presentation of inferred progress would duplicate application state and be harder to trust.

## Considered Options

- Present nested activity summaries with separate UI detail
- Capture application log events and render a flat log

## Decision Outcome

Chosen option: Capture application log events and render a flat log, because users need a compact, trustworthy view of what the application actually did.

Emit activity events from actual application operations through Effect logging and capture them in a shared adapter. Persist a bounded recent log locally and render it from the information icon beside status. Use flat timestamp, colored severity icon, and message rows in a compact log box. Avoid nested steps, visible duration metadata, redundant severity labels, and loading ellipses in recorded events.

Sanitize known secrets, credential-like strings, and repository URLs before storage and diagnostic copying. Keep the log separate from durable sync state.

### Consequences

The UI reflects emitted events rather than manufacturing a simulated timeline. Bounded retention is useful for recent troubleshooting but is not a complete audit trail. A broken activity file must not destroy sync state. Redaction is defensive, not a guarantee that every user-written string is non-sensitive.

## More Information

### References

- [Effect logging](https://effect.website/docs/observability/logging/)
