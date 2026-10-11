# Gitbin features

This document follows the [FEATURES.md format](https://features.md/). It describes the current source tree, which includes work newer than release 0.0.4. `stable` identifies established released behavior; `in-progress` identifies unreleased or experimentally supported behavior. Checked criteria point to existing coverage, not a claim that every device has been tested.

## Sync across devices

- **Stability**: stable
- **Description**: Edit offline and sync notes and attachments through your own Git repository when you reconnect.
- **Properties**:
  - Automatic sync runs while Obsidian is open. Manual sync is also available.
  - Concurrent text edits merge automatically. Attachments resolve as complete versions, without merging their bytes.
  - Multiple vaults share a repository in separate folders. Matching vault names identify the same vault across devices.
  - Hidden configuration folders remain local. Credentials use Obsidian's secret storage.
- **Test Criteria**:
  - [x] Concurrent changes converge and pending edits survive restarts: [sync tests](tests/sync.test.ts), [device tests](tests/device.test.ts).
  - [x] Vault boundaries and credential handling are covered: [vault tests](tests/vault.test.ts), [authentication tests](tests/auth.test.ts).

## On-demand downloads

- **Stability**: in-progress — implemented, unreleased
- **Description**: Keep all files visible in Obsidian while downloading their contents only when needed. Useful for large vaults or limited local storage.
- **Properties**:
  - Opening a file or displaying an embed triggers its download. Unloaded notes cannot be edited until ready.
  - Files without an Obsidian viewer can be downloaded through **Gitbin: Download** in the file menu, then opened in a compatible app.
  - **Local storage limit** controls space used by vault files and Gitbin's cache when on-demand downloads are enabled. Unused downloads can be removed; open files, visible embeds, unsynced edits, and active downloads are protected.
  - **Max download size** applies equally to notes and attachments. It does not restrict uploads or already cached content. A finite local storage limit also constrains downloads; Unlimited does not override that capacity.
  - Downloads that cannot fit explain which setting needs attention. Remote content remains available in the repository.
  - Unloaded files are empty placeholders. Full-text search, backlinks, other plugins, and external filesystem sync tools cannot treat them as downloaded content. Unexpected writes are preserved as recovery files.
  - Offline access requires downloaded content. Protected files can prevent cleanup from meeting the configured storage target.
- **Test Criteria**:
  - [x] Opening files and embeds hydrates placeholders without publishing empty content: [file-open tests](tests/lazy-file-open.test.ts), [embed tests](tests/lazy-embeds.test.ts), [selective sync tests](tests/selective.test.ts).
  - [x] Download limits and cleanup protect pending work: [download tests](tests/selective-download.test.ts), [capacity tests](tests/inventory-capacity.test.ts).
  - [ ] Validate resource use and native file opening on physical mobile devices.

## Sync history and activity

- **Stability**: in-progress — history is released; activity logging and deferred comparisons are unreleased
- **Description**: Review file changes and see what sync is doing when something needs attention.
- **Properties**:
  - Sync history offers Local, Remote, and Final comparisons where available.
  - With on-demand downloads, a comparison may need a separate download. The refresh icon loads it; requests requiring the network are disabled offline. Downloading a comparison does not make the file locally available for editing.
  - The information icon beside sync status opens recent activity. Each line shows a timestamp, a colored severity icon, and the application event.
  - Recent activity persists locally with bounded retention. Copied diagnostics redact known secrets and repository URLs; review them before sharing.
- **Test Criteria**:
  - [x] Deferred comparisons respect caching and offline behavior: [history tests](tests/selective-history.test.ts).
  - [x] Real sync events, persistence, severity, and redaction are covered: [activity tests](tests/activity.test.ts), [Git activity tests](tests/activity-git.test.ts), [activity UI tests](tests/activity-ui.test.tsx).

## Repository maintenance

- **Stability**: in-progress — implemented, unreleased
- **Description**: Clean up accumulated history or repair damaged metadata so your vaults can sync again.
- **Properties**:
  - **Consolidate** keeps the latest committed files and replaces the branch history with one commit. Use it to discard old revisions or when sync asks you to consolidate after an update.
  - **Reinitialize repository** rebuilds metadata from committed repository files. Use it to repair damaged metadata, not to upload the current device as a replacement snapshot.
  - Both actions affect the repository's vaults and force-push `main`. Read the warning and complete the checklist before continuing. Opening or cancelling the dialog does not start repository work.
  - Pending local edits remain for the next sync. Back up files and history you need before continuing, and update Gitbin on every device.
  - Other branches and tags are unchanged. Host retention and garbage collection mean immediate repository size savings are not guaranteed.
  - Required migrations pause sync until the user confirms consolidation. They never run automatically during normal sync.
- **Test Criteria**:
  - [x] Confirmation, cancellation, publication races, and interrupted recovery are covered: [maintenance UI tests](tests/consolidation-ui.test.tsx), [consolidation tests](tests/consolidation.test.ts).
  - [x] Rebuilding preserves committed files and pending device changes: [reinitialization tests](tests/reinitialize.test.ts), [selective maintenance tests](tests/selective-maintenance.test.ts).

## Structured Canvas merging

- **Stability**: in-progress — implemented, unreleased
- **Description**: Merge independent changes to Canvas cards, text, and connections while continuing to use Obsidian's native Canvas editor.
- **Properties**:
  - Canvas files remain ordinary `.canvas` files. Cards and connections merge by identity; text inside cards supports concurrent edits.
  - Deleting a card takes precedence over concurrent edits and removes connections to it. Unknown properties are preserved.
  - Invalid Canvas data remains local for correction rather than replacing a valid remote document.
  - Existing repositories require confirmed consolidation before structured merging is available.
- **Test Criteria**:
  - [x] Concurrent text, properties, ordering, and deletion behavior are covered: [Canvas tests](tests/canvas.test.ts), [Canvas sync tests](tests/canvas-sync.test.ts).
  - [x] Migration and Git publication preserve pending work: [Canvas migration tests](tests/canvas-migration.test.ts), [Canvas Git tests](tests/canvas-git.test.ts).

## Scan to sync

- **Stability**: in-progress — released, but physical mobile validation is outstanding
- **Description**: Transfer an existing repository setup from desktop to a phone without typing the configuration again.
- **Properties**:
  - The phone needs Gitbin installed and a vault with the same name.
  - The encrypted QR requires the displayed six-digit code and confirmation in Obsidian. No pairing service receives the configuration.
  - QR codes rotate and expire. Configurations too large for a QR must be entered manually.
- **Test Criteria**:
  - [x] Encryption, expiry, QR generation, and setup handling are covered: [setup transfer tests](tests/setup-transfer.test.ts), [QR tests](tests/setup-qr.test.ts), [code tests](tests/setup-code.test.ts).
  - [ ] Validate the complete scan-and-connect flow on physical mobile devices.
