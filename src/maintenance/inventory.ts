import { BinaryObjects } from "../core/blobs";
import { contentBytes } from "../core/content";
import { FileDocument } from "../core/file";
import {
  type InventoryFile,
  inventoryPath,
  objectReference,
  validateInventory,
} from "../core/inventory";
import type { MigrationSnapshot } from "./types";
import { repositoryVaults } from "./validation";

function inventoryFile(
  source: ReadonlyMap<string, Uint8Array>,
  root: string,
  statePath: string,
  state: Uint8Array,
): InventoryFile {
  const id = statePath.slice(statePath.lastIndexOf("/") + 1, -4);
  const file = new FileDocument(id, undefined, new BinaryObjects());
  try {
    file.merge(state);
    const locations = file.locations();
    if (locations.length !== 1)
      throw new Error("Resolve file locations before building inventory.");
    const path = locations[0]?.[1].path ?? null;
    const kind = statePath.includes("/attachments/") ? "binary" : "text";
    const bytes =
      path === null ? deletedContent(file, source, root, kind) : source.get(`${root}/${path}`);
    if (!bytes) throw new Error("Inventory file is missing its committed content.");
    return {
      id,
      path,
      statePath,
      state: objectReference(state),
      content: objectReference(bytes),
      kind,
      locations: [
        {
          id: locations[0]?.[0] ?? id,
          path,
          parents: [],
          contentHash: objectReference(bytes).hash,
        },
      ],
    };
  } finally {
    file.destroy();
  }
}

function deletedContent(
  file: FileDocument,
  source: ReadonlyMap<string, Uint8Array>,
  root: string,
  kind: "text" | "binary",
): Uint8Array | undefined {
  if (kind === "text") return contentBytes(file.content);
  const value = file.doc.getMap<{ value: string }>("content").get("value");
  if (!value) return undefined;
  const retained = source.get(`.gitbin/vaults/${root}/retained/${value.value}`);
  if (retained) return retained;
  for (const [path, bytes] of source)
    if (path.startsWith(root + "/") && objectReference(bytes).hash === value.value) return bytes;
  return undefined;
}

export function addInventories(source: MigrationSnapshot): MigrationSnapshot {
  if (source.kind === "device") return source;
  const files = new Map(source.files);
  for (const root of repositoryVaults(files)) {
    const records: InventoryFile[] = [];
    for (const [path, bytes] of source.files) {
      if (
        path.startsWith(`.gitbin/vaults/${root}/`) &&
        /\/(notes|attachments)\/[^/]+\.bin$/.test(path)
      )
        records.push(inventoryFile(source.files, root, path, bytes));
    }
    records.sort((left, right) => left.id.localeCompare(right.id));
    for (const record of records) retainDeleted(source, files, root, record);
    const inventory = { files: records };
    validateInventory(inventory, root);
    files.set(inventoryPath(root), new TextEncoder().encode(JSON.stringify(inventory)));
  }
  return { ...source, files };
}

function retainDeleted(
  source: MigrationSnapshot,
  files: Map<string, Uint8Array>,
  root: string,
  record: InventoryFile,
): void {
  if (record.path !== null) return;
  const retained = `.gitbin/vaults/${root}/retained/${record.content.hash}`;
  if (files.has(retained)) return;
  const bytes = source.files.get(record.statePath);
  if (!bytes) throw new Error("Missing deleted file state.");
  const document = new FileDocument(record.id);
  try {
    document.merge(bytes);
    const content = deletedContent(document, source.files, root, record.kind);
    if (!content) throw new Error("Missing deleted file content.");
    files.set(retained, content);
  } finally {
    document.destroy();
  }
}
