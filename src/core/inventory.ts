import { sha1 } from "@noble/hashes/legacy.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { Schema } from "effect";
import { BlobId } from "./blobs";
import { resolvedLocation, validateLocations } from "./locations";
import { validateVaults, validPath } from "./protocol";

export { inventoryPath } from "./path-rules";

const Bytes = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
);
export const ObjectReference = Schema.Struct({ hash: BlobId, bytes: Bytes });
export type ObjectReference = typeof ObjectReference.Type;
const LocationOperation = Schema.Struct({
  id: Schema.String,
  path: Schema.NullOr(Schema.String),
  parents: Schema.Array(Schema.String),
  contentHash: BlobId,
});
export type LocationOperation = typeof LocationOperation.Type;
export const InventoryFile = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^[a-f0-9-]{36}$/)),
  path: Schema.NullOr(Schema.String),
  statePath: Schema.String,
  state: ObjectReference,
  content: ObjectReference,
  kind: Schema.Literals(["text", "binary"]),
  locations: Schema.Array(LocationOperation),
});
export type InventoryFile = typeof InventoryFile.Type;
const Inventory = Schema.Struct({ files: Schema.Array(InventoryFile) });
export type Inventory = typeof Inventory.Type;

export function objectReference(bytes: Uint8Array): ObjectReference {
  const hash = bytesToHex(
    sha1
      .create()
      .update(new TextEncoder().encode(`blob ${bytes.length}\0`))
      .update(bytes)
      .digest(),
  );
  return { hash, bytes: bytes.length };
}

export function validateInventory(inventory: Inventory, root: string): void {
  validateVaults([{ root, name: root }]);
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const file of inventory.files) {
    validateLocations(file.locations);
    if (resolvedLocation(file) !== file.path)
      throw new Error("Inventory path differs from its location history.");
    if (ids.has(file.id)) throw new Error("Duplicate inventory identity.");
    ids.add(file.id);
    const category = file.kind === "text" ? "notes" : "attachments";
    if (file.statePath !== `.gitbin/vaults/${root}/${category}/${file.id}.bin`)
      throw new Error("Inventory state is outside its vault.");
    if (file.path === null) continue;
    if (!validPath(file.path)) throw new Error("Unsafe inventory path.");
    const path = file.path.toLowerCase();
    if (paths.has(path)) throw new Error("Duplicate inventory path.");
    paths.add(path);
  }
  validateFolders(paths);
}

function validateFolders(paths: ReadonlySet<string>): void {
  for (const path of paths) {
    const segments = path.split("/");
    segments.pop();
    while (segments.length) {
      if (paths.has(segments.join("/"))) throw new Error("Inventory file blocks a folder.");
      segments.pop();
    }
  }
}

export function decodeInventory(bytes: Uint8Array, root: string): Inventory {
  const inventory = Schema.decodeUnknownSync(Inventory, { onExcessProperty: "error" })(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  );
  validateInventory(inventory, root);
  return inventory;
}

export function verifyObject(bytes: Uint8Array, reference: ObjectReference): void {
  if (bytes.length !== reference.bytes || objectReference(bytes).hash !== reference.hash)
    throw new Error("Downloaded object differs from its inventory reference.");
}
