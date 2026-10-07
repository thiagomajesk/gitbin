# Gitbin

Gitbin lets you sync your Obsidian vaults across devices using Git. It resolves conflicts automatically using CRDTs, so you can work offline and sync when you reconnect.

## Features

- Sync vault files and attachments across devices over HTTPS.
- Merge concurrent text edits and resolve file conflicts automatically with CRDTs.
- Keep editing offline and sync when you reconnect.
- Sync manually or automatically while Obsidian is open.
- Browse sync history with per-file Local, Remote and Final comparisons.
- Store multiple vaults in one repository, each in its own folder.
- Save credentials in Obsidian's secret storage on each device.
- Transfer a working setup to your phone with **Scan to sync**.

Mobile support is experimental and has not yet been tested on physical devices.

Gitbin connects to the Git host you configure to download and upload vault content. It enumerates vault files for syncing and keeps hidden configuration folders local. File content is read and written through Obsidian's APIs.

## How to use

1. **Install Gitbin.** Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/thiagomajesk/gitbin/releases/latest) into your vault's `.obsidian/plugins/gitbin/` folder, or install the release using [BRAT](https://github.com/TfTHacker/obsidian42-brat). Reload Obsidian and enable **Gitbin** under **Settings → Community plugins**.
2. **Open Settings → Gitbin.** Enter your repository's HTTPS clone URL and the username of an account with write access. Optionally enter a commit email associated with your hosting account, including its private/noreply address, to link commits to your profile. Use a new empty repository or one already used by Gitbin. Each vault uses its local name as its repository folder, so use the same vault name on every device.
3. **Set up authentication.** GitHub does not accept your account password for Git over HTTPS. Go to **GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens**, generate a token for the repository, and grant **Contents: Read and write**. Paste it into **Password or access token**. Other hosts use their own tokens or may allow passwords.
4. **Click Connect.** Gitbin starts syncing. Continue editing normally, or use **Sync now** in settings. Repeat these steps on your other devices using the same repository and vault name. Click the Gitbin icon in Obsidian's sidebar to view sync history.

To set up your phone, create a vault with the same name and install and enable Gitbin there. On your connected desktop, click **Scan to sync** in Gitbin settings, scan the QR with your phone, and enter the six-digit code shown on the desktop. Confirm **Connect and sync** in Obsidian. The encrypted QR and its code refresh every 30 seconds; scanned codes expire after two minutes. Configuration stays on your devices, with no pairing service. Very large configurations must be entered manually.

## How it works

Gitbin uses a Git repository to sync your vault's files between devices and CRDTs to resolve concurrent edits, moves and deletions automatically. Text edits are merged; binary files resolve as complete versions without merging their bytes. You can work offline and sync your changes when you reconnect.

> [!WARNING]
> Avoid symbolic links and junctions in your vault. Gitbin uses Obsidian's file APIs, which don't expose local symlink detection. Linked files or folders may cause sync to read or modify files outside your vault. See [Obsidian's guidance on symbolic links and junctions](https://obsidian.md/help/symlinks) and [Snyk's explanation of symlink risks](https://snyk.io/blog/symlinks-are-still-scary/) for more information.

## Development

### Requirements

- Node.js 24 or later.
- pnpm 11.19.0.
- Obsidian 1.13.0 or later.

### Commands

| Command | Description |
| --- | --- |
| `pnpm build` | Build the plugin into `dist/gitbin/`. |
| `pnpm watch` | Rebuild as source files change. |
| `pnpm dev` | Rebuild and deploy changes to your open Obsidian vault. |
| `pnpm check` | Run strict TypeScript checks. |
| `pnpm test` | Run sync and UI tests. |
| `pnpm format` | Check formatting. |
| `pnpm format:fix` | Apply formatting. |
| `pnpm lint` | Run Biome lint checks. |
| `pnpm lint:obsidian` | Run the official Obsidian ESLint rules with no warnings. |
| `pnpm analyze` | Check for dead code with Fallow. |
| `pnpm analyze:health` | Check complexity and code health with Fallow. |
| `pnpm quality` | Run all checks, tests, and the production build. |
