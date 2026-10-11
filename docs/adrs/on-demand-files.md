---
status: accepted
---

# On-demand files in the native explorer

## Context and Problem Statement

Large vaults should not require all content locally. The required experience keeps all files in Obsidian's normal explorer; a separate Gitbin file browser was rejected. Git partial clone can omit blobs but cannot create remote-file entries in Obsidian.

## Considered Options

- Browse remote files in a separate Gitbin panel
- Keep unloaded files in the native explorer with protected placeholders

## Decision Outcome

Chosen option: Keep unloaded files in the native explorer with protected placeholders, because all files must remain visible in Obsidian while their contents are downloaded only when needed.

Use just-git's partial-fetch capability for transport and an explicit content inventory for file identity, object references, and availability. Pin the supporting just-git preview build in the dependency lockfile. Represent unloaded files with empty local placeholders, never as authoritative empty content.

Hydrate before opening or editing, using a shared loading view and editor protection. Download visible embeds too. For files without a native viewer, expose **Gitbin: Download**. Apply this by availability and size rather than a list of special attachment types.

Build publication from the inventory so placeholders cannot become empty uploads or accidental deletions. Preserve unexpected placeholder writes as recovery files. Load history comparisons independently; a comparison fetch does not hydrate the working file.

### Consequences

The integration needs explicit lifecycle and write protection beyond Git. Search, backlinks, other plugins, and unrelated filesystem sync tools cannot read missing contents. Offline access and comparisons depend on cached objects. Native open/close behavior, embeds, restarts, and concurrent writes need integration coverage. The dependency preview must be reconsidered when upstream provides the required API; a second custom Git transport is not the chosen solution.

## More Information

### References

- [Git partial clone](https://git-scm.com/docs/partial-clone)
- [Obsidian Vault API guide](https://docs.obsidian.md/Plugins/Vault)
