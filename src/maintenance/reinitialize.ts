import { rawContentKind } from "../core/content";
import { type InventoryFile, inventoryPath, objectReference } from "../core/inventory";
import { currentMetadata, metadataPath } from "../core/metadata";
import { hiddenPath, metadataEntry, stateLocation } from "../core/path-rules";
import { checkRoot, validateVaults, validPath } from "../core/protocol";
import { RawDocument } from "../core/raw-document";
import type { MigrationSnapshot } from "./types";
import { validateCurrent } from "./validation";

export function reinitializationRoots(paths: Iterable<string>, roots: readonly string[]): string[] {
  const discovered = [...paths].flatMap((path) => {
    const root = /^\.gitbin\/vaults\/([^/]+)\//.exec(path)?.[1];
    return root && checkRoot(root) ? [root] : [];
  });
  return [...new Set([...roots, ...discovered])];
}

function rebuildFile(
  files: Map<string, Uint8Array>,
  root: string,
  path: string,
  bytes: Uint8Array,
): InventoryFile {
  const id = crypto.randomUUID();
  const kind = rawContentKind(path, bytes);
  const content = objectReference(bytes);
  const statePath = stateLocation(root, id, kind === "binary");
  const document = new RawDocument();
  try {
    document.edit(bytes, kind);
    const state = document.bytes();
    files.set(statePath, state);
    return {
      id,
      path,
      kind,
      content,
      statePath,
      state: objectReference(state),
      locations: [{ id: crypto.randomUUID(), path, parents: [], contentHash: content.hash }],
    };
  } finally {
    document.close();
  }
}

/** Recovery must never depend on decoding the metadata it is replacing. */
export function reinitializeRepository(
  source: MigrationSnapshot,
  roots: readonly string[],
): MigrationSnapshot {
  if (source.kind !== "repository" || roots.length === 0)
    throw new Error("Select at least one vault to reinitialize.");
  // Folder names remain useful even when their state bytes cannot be decoded.
  const vaults = reinitializationRoots(source.files.keys(), roots);
  validateVaults(vaults.map((root) => ({ root, name: root })));
  const files = new Map([...source.files].filter(([path]) => !metadataEntry(path)));
  files.set(metadataPath, new TextEncoder().encode(JSON.stringify(currentMetadata())));
  for (const root of vaults) {
    const records: InventoryFile[] = [];
    for (const [path, bytes] of source.files) {
      if (!path.startsWith(root + "/")) continue;
      const relative = path.slice(root.length + 1);
      if (hiddenPath(relative)) continue;
      if (!validPath(relative)) throw new Error("Unsupported vault file path: " + relative);
      records.push(rebuildFile(files, root, relative, bytes));
    }
    files.set(inventoryPath(root), new TextEncoder().encode(JSON.stringify({ files: records })));
  }
  const result = { kind: "repository" as const, files };
  validateCurrent(result);
  return result;
}
