import { contentFromBytes } from "../core/content";
import { FileDocument } from "../core/file";
import { currentMetadata, metadataPath } from "../core/metadata";
import { hiddenPath, metadataEntry } from "../core/path-rules";
import { checkRoot, validateVaults, validPath } from "../core/protocol";
import { statePath } from "../core/storage-layout";
import type { MigrationSnapshot } from "./types";
import { validateCurrent } from "./validation";

/** Recovery must never depend on decoding the metadata it is replacing. */
export function reinitializeRepository(
  source: MigrationSnapshot,
  roots: readonly string[],
): MigrationSnapshot {
  if (source.kind !== "repository" || roots.length === 0)
    throw new Error("Select at least one vault to reinitialize.");
  // Folder names remain useful even when their state bytes cannot be decoded.
  const discovered = [...source.files.keys()].flatMap((path) => {
    const root = /^\.gitbin\/vaults\/([^/]+)\//.exec(path)?.[1];
    return root && checkRoot(root) ? [root] : [];
  });
  const vaults = [...new Set([...roots, ...discovered])];
  validateVaults(vaults.map((root) => ({ root, name: root })));
  const files = new Map([...source.files].filter(([path]) => !metadataEntry(path)));
  files.set(metadataPath, new TextEncoder().encode(JSON.stringify(currentMetadata())));
  for (const root of vaults) {
    for (const [path, bytes] of source.files) {
      if (!path.startsWith(root + "/")) continue;
      const relative = path.slice(root.length + 1);
      if (hiddenPath(relative)) continue;
      if (!validPath(relative)) throw new Error("Unsupported vault file path: " + relative);
      const file = new FileDocument(crypto.randomUUID());
      try {
        file.edit(contentFromBytes(relative, bytes));
        file.move(relative);
        const state = file.bytes();
        files.set(statePath(root, file.id, state), state);
      } finally {
        file.destroy();
      }
    }
  }
  const result = { kind: "repository" as const, files };
  validateCurrent(result);
  return result;
}
