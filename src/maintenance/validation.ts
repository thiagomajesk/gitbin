import { Schema } from "effect";
import { AvailabilityJournal } from "../core/availability";
import { decodeInventory, inventoryPath, validateInventory, verifyObject } from "../core/inventory";
import { Metadata, metadataPath } from "../core/metadata";
import { safeSnapshotPath } from "../core/path-rules";
import { RawDocument } from "../core/raw-document";
import { discoverVaults } from "../git/vaults";
import type { MigrationSnapshot } from "./types";

export function repositoryVaults(files: ReadonlyMap<string, Uint8Array>): string[] {
  return [
    ...new Set(
      [...files.keys()].flatMap((path) => {
        const root =
          /^\.gitbin\/vaults\/([^/]+)\/(?:inventory\.json|(?:notes|attachments)\/[a-f0-9-]{36}\.bin)$/.exec(
            path,
          )?.[1];
        return root ? [root] : [];
      }),
    ),
  ].sort();
}
function validateVault(files: ReadonlyMap<string, Uint8Array>, root: string): void {
  const inventory = files.get(inventoryPath(root));
  if (!inventory) throw new Error("Missing vault inventory.");
  for (const file of decodeInventory(inventory, root).files) {
    const state = files.get(file.statePath);
    const path =
      file.path === null
        ? `.gitbin/vaults/${root}/retained/${file.content.hash}`
        : root + "/" + file.path;
    const content = files.get(path);
    if (!state || !content) throw new Error("Missing inventory object.");
    verifyObject(state, file.state);
    verifyObject(content, file.content);
    const document = new RawDocument(state);
    try {
      document.verify(file.content);
    } finally {
      document.close();
    }
  }
}
function validateDevice(files: ReadonlyMap<string, Uint8Array>): void {
  const journal = Schema.decodeUnknownSync(AvailabilityJournal, { onExcessProperty: "error" })(
    JSON.parse(new TextDecoder().decode(files.get("journal.json"))),
  );
  for (const entry of journal.entries) {
    validateInventory({ files: [entry.file] }, journal.vaultRoot);
    if (entry.base) validateInventory({ files: [entry.base] }, journal.vaultRoot);
  }
  for (const [path, bytes] of files) {
    if (path.startsWith("objects/"))
      verifyObject(bytes, { hash: path.slice(8), bytes: bytes.length });
  }
  for (const intent of journal.intents) {
    if (intent.after && !files.has("objects/" + intent.after.hash))
      throw new Error("Missing interrupted-write object.");
  }
}
export function validateCurrent(snapshot: MigrationSnapshot): void {
  if (snapshot.kind === "device") {
    validateDevice(snapshot.files);
    return;
  }
  Schema.decodeUnknownSync(Metadata, { onExcessProperty: "error" })(
    JSON.parse(new TextDecoder().decode(snapshot.files.get(metadataPath))),
  );
  for (const path of snapshot.files.keys())
    if (!safeSnapshotPath(path)) throw new Error("Unsafe snapshot path.");
  discoverVaults(new Map([...snapshot.files.keys()].map((path) => [path, ""])));
  for (const root of repositoryVaults(snapshot.files)) validateVault(snapshot.files, root);
}
