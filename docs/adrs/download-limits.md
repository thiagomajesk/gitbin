---
status: accepted
---

# Explicit download and storage limits

## Context and Problem Statement

Earlier iterations had note-size and image-pixel restrictions that users could not control. Reusing a download setting for uploads also prevented existing local work from syncing. Limits should follow file size and explicit settings, regardless of file type.

## Considered Options

- Keep separate internal restrictions for notes and attachment types
- Use a percentage of local storage as the download limit
- Use explicit file-size and local-storage settings

## Decision Outcome

Chosen option: Use explicit file-size and local-storage settings, because users can understand and control them consistently across file types without blocking uploads.

Use two controls: local storage capacity for on-demand mode, and maximum size for an individual download. Offer explicit presets and Unlimited. Apply the same download policy to notes and all attachments; remove hidden per-type, pixel, and upload restrictions. Do not add offline pinning or a Keep offline feature.

Check inventory sizes before downloads where available, remove eligible unused content to make room, and protect open files, visible embeds, pending edits, and active downloads. Reject a download that cannot fit with an actionable message. Unlimited download size does not override finite local capacity. Repository maintenance is not an ordinary user-file download.

### Consequences

The local storage target is not a promise that protected content can always be evicted. Unknown sizes in legacy or unmanaged objects cannot always be checked before fetching with the current just-git API; do not claim a universal preflight guarantee or add an unrelated maintenance probe. A host can reject uploads independently of these settings, and pending edits must survive that rejection.
