# Gitbin

Sync your Obsidian vaults across devices using Git. Work offline and sync when you reconnect, with concurrent text edits merged automatically.

1. Install and enable [Gitbin from Obsidian's community plugins](https://obsidian.md/plugins?id=gitbin).
2. Open **Settings → Gitbin**, enter your repository's HTTPS URL and credentials with read/write access, then click **Connect**.
3. Repeat on your other devices using the same repository and vault name, or use **Scan to sync** to set up your phone.

## Feature highlights

- **Work across devices.** Sync notes and attachments automatically while Obsidian is open, or sync manually when you choose.
- **Keep your repository.** Store multiple vaults in one Git repository, each in its own folder.
- **Review changes.** Browse sync history and compare local, remote, and merged files.
- **Set up another device.** Reuse your repository and vault name, or use **Scan to sync** to transfer your setup to a phone.
- **Save space.** Download files when you open them and choose how much local storage to use.
- **Maintain your vault.** Consolidate old history or repair damaged metadata when needed.

On-demand downloads, maintenance, activity logs, and structured Canvas merging are newer than release 0.0.4. Mobile support is experimental and has not yet been tested on physical devices.

## How it works

Gitbin stores readable vault files in your Git repository alongside the metadata needed to merge changes. CRDTs combine concurrent text edits; attachments resolve as complete versions. Each device keeps pending changes locally until it can sync again.

Gitbin connects to the Git host you configure. Credentials stay in Obsidian's secret storage, and hidden configuration folders stay local. With on-demand downloads enabled, files remain visible in the explorer, but their contents must be downloaded before search, backlinks, or other plugins can read them.

> [!WARNING]
> Avoid symbolic links and junctions in your vault. Gitbin uses Obsidian's file APIs, which don't expose local symlink detection. Linked files or folders may cause sync to read or modify files outside your vault. See [Obsidian's guidance on symbolic links and junctions](https://obsidian.md/help/symlinks) and [Snyk's explanation of symlink risks](https://snyk.io/blog/symlinks-are-still-scary/) for more information.

## See also

- [FEATURES.md](FEATURES.md)
- [CONTRIBUTING.md](CONTRIBUTING.md)
