import {
  decodeInventory,
  type InventoryFile,
  inventoryPath,
  objectReference,
} from "../core/inventory";
import { RawDocument } from "../core/raw-document";
import type { MigrationSnapshot } from "./types";
import { repositoryVaults, validateCurrent } from "./validation";

export function compactRepository(source: MigrationSnapshot): MigrationSnapshot {
  const files = new Map([...source.files].filter(([path]) => !path.startsWith(".gitbin/vaults/")));
  for (const root of repositoryVaults(source.files)) {
    const bytes = source.files.get(inventoryPath(root));
    if (!bytes) throw new Error("Missing inventory before consolidation.");
    const records: InventoryFile[] = [];
    for (const file of decodeInventory(bytes, root).files) {
      if (file.path === null) continue;
      const content = source.files.get(root + "/" + file.path);
      if (!content) throw new Error("Missing committed file.");
      const reference = objectReference(content);
      const document = new RawDocument();
      try {
        document.edit(content, file.kind);
        const state = document.bytes();
        files.set(file.statePath, state);
        records.push({
          ...file,
          state: objectReference(state),
          content: reference,
          locations: [
            {
              id: crypto.randomUUID(),
              path: file.path,
              parents: [],
              contentHash: reference.hash,
            },
          ],
        });
      } finally {
        document.close();
      }
    }
    files.set(inventoryPath(root), new TextEncoder().encode(JSON.stringify({ files: records })));
  }
  const result = { ...source, files };
  validateCurrent(result);
  return result;
}
