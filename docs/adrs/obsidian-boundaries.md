---
status: accepted
---

# Obsidian APIs and device-local credentials

## Context and Problem Statement

Vault access must fit Obsidian's lifecycle and work across desktop and mobile. Desktop filesystem assumptions would make sync dependent on Node APIs unavailable on mobile. Credentials must not become repository content.

## Considered Options

- Access vault files through Node filesystem APIs
- Access vault files through Obsidian APIs

## Decision Outcome

Chosen option: Access vault files through Obsidian APIs, because runtime vault access must fit Obsidian and remain usable on mobile.

Read and write vault content through Obsidian Vault and DataAdapter APIs, with platform adapters between Obsidian and domain operations. Keep hidden configuration folders out of synced vault content. Use HTTPS transport and Obsidian secret storage for credentials on each device.

Transfer setup through an encrypted QR and a separate short code, with expiry and explicit confirmation. Do not introduce a pairing backend. Node filesystem APIs remain appropriate for build and test tooling, not runtime vault access.

### Consequences

The core can be tested using injected ports, but adapters and native UI still need integration validation. Mobile remains experimental until exercised on physical devices. Obsidian's APIs do not expose reliable local symlink detection, so documentation must warn about linked folders rather than claim they are safely isolated. Repository maintenance can reject symlink and submodule entries visible in Git trees.

## More Information

### References

- [Obsidian Vault API guide](https://docs.obsidian.md/Plugins/Vault)
- [Obsidian mobile development](https://docs.obsidian.md/Plugins/Getting+started/Mobile+development)
