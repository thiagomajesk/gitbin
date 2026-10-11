import { attempt } from "../core/errors";
import {
  decodeInventory,
  type InventoryFile,
  inventoryPath,
  objectReference,
} from "../core/inventory";
import { stateLocation } from "../core/path-rules";
import { RawDocument } from "../core/raw-document";
import type { MigrationSnapshot, StorageMigration } from "./types";
import { repositoryVaults, validateCurrent } from "./validation";

function pending(file: InventoryFile): boolean {
  return file.path?.toLowerCase().endsWith(".canvas") === true && file.kind !== "canvas";
}
function inventories(source: MigrationSnapshot) {
  return repositoryVaults(source.files).map((root) => {
    const bytes = source.files.get(inventoryPath(root));
    if (!bytes) throw new Error("Missing vault inventory.");
    return { root, inventory: decodeInventory(bytes, root) };
  });
}
function convert(files: Map<string, Uint8Array>, root: string, file: InventoryFile): InventoryFile {
  if (!pending(file)) return file;
  const bytes = files.get(root + "/" + file.path);
  if (!bytes) throw new Error("Missing Canvas file: " + file.path);
  const document = new RawDocument();
  try {
    document.edit(bytes, "canvas");
    document.verify(file.content);
    const state = document.bytes();
    const statePath = stateLocation(root, file.id, false);
    files.delete(file.statePath);
    files.set(statePath, state);
    return { ...file, kind: "canvas", statePath, state: objectReference(state) };
  } catch (cause) {
    throw new Error(
      "Cannot migrate Canvas " +
        file.path +
        ". Fix the file before consolidating; its contents have been preserved.",
      { cause },
    );
  } finally {
    document.close();
  }
}
function transform(source: MigrationSnapshot): MigrationSnapshot {
  // Device baselines stay intact until the new consolidation is integrated. Pending
  // edits are then rebased onto the repository state or preserved as recovery files.
  if (source.kind === "device") return source;
  const files = new Map(source.files);
  for (const { root, inventory } of inventories(source)) {
    const records = inventory.files.map((file) => convert(files, root, file));
    files.set(inventoryPath(root), new TextEncoder().encode(JSON.stringify({ files: records })));
  }
  return { ...source, files };
}
export const structuredCanvasMigration: StorageMigration = {
  id: "structured-canvas",
  title: "Merge Canvas cards and connections independently",
  inspect: (source) =>
    attempt("Cannot inspect Canvas data.", () => ({
      status:
        source.kind === "repository" &&
        inventories(source).some(({ inventory }) => inventory.files.some(pending))
          ? "needed"
          : "satisfied",
    })),
  transform: (source) => attempt("Cannot migrate Canvas data.", () => transform(source)),
  validate: (source) =>
    attempt("Invalid Canvas migration.", () => {
      validateCurrent(source);
      if (
        source.kind === "repository" &&
        inventories(source).some(({ inventory }) => inventory.files.some(pending))
      )
        throw new Error("Canvas migration is incomplete.");
    }),
};
