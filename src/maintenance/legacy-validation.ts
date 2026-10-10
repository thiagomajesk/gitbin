import { Schema } from "effect";
import { BinaryObjects, binaryObject } from "../core/blobs";
import { contentFromBytes, type FileContent } from "../core/content";
import { FileDocument } from "../core/file";
import { Metadata, metadataPath } from "../core/metadata";
import { hiddenPath, safeSnapshotPath } from "../core/path-rules";
import { validateRemote } from "../core/projection";
import { Journal, validateVaults } from "../core/protocol";
import type { MigrationSnapshot } from "./types";

function repositoryVaults(files: ReadonlyMap<string, Uint8Array>): string[] {
  return [
    ...new Set(
      [...files.keys()].flatMap((path) => {
        const match = /^\.gitbin\/vaults\/([^/]+)\/[a-f0-9-]{36}\.bin$/.exec(path);
        return match?.[1] ? [match[1]] : [];
      }),
    ),
  ].sort();
}

function validateVault(files: ReadonlyMap<string, Uint8Array>, root: string): void {
  const states = new Map<string, Uint8Array>();
  const contents = new Map<string, FileContent>();
  const blobs = new Map<string, FileContent>();
  for (const [path, bytes] of files) {
    if (path.startsWith(".gitbin/vaults/" + root + "/"))
      states.set(path.split("/").at(-1)?.slice(0, -4) ?? "", bytes);
    else if (path.startsWith(".gitbin/blobs/" + root + "/")) {
      const id = path.split("/").at(-1) ?? "";
      blobs.set(id, binaryObject(id, bytes));
    } else if (path.startsWith(root + "/")) {
      const relative = path.slice(root.length + 1);
      if (!hiddenPath(relative)) contents.set(relative, contentFromBytes(relative, bytes));
    }
  }
  validateRemote({
    revision: null,
    vaults: [{ name: root, root }],
    states,
    files: contents,
    blobs,
  });
}

function validateDevice(files: ReadonlyMap<string, Uint8Array>): void {
  const journal = Schema.decodeUnknownSync(Journal, { onExcessProperty: "error" })({
    checkpoint: null,
    ...JSON.parse(new TextDecoder().decode(files.get("journal.json"))),
  });
  const blobs = new BinaryObjects();
  for (const id of journal.blobs) {
    const bytes = files.get("blobs/" + id);
    if (!bytes) throw new Error("Missing device binary object.");
    blobs.import(new Map([[id, binaryObject(id, bytes)]]));
  }
  for (const stored of journal.files) {
    const file = new FileDocument(stored.id, stored, blobs);
    try {
      void file.content;
      file.binaryIds(true);
    } finally {
      file.destroy();
    }
  }
  for (const intent of journal.intents) {
    blobs.resolve(intent.before);
    blobs.resolve(intent.after);
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
  for (const path of snapshot.files.keys()) {
    if (!safeSnapshotPath(path)) throw new Error("Unsafe snapshot path.");
  }
  validateVaults(repositoryVaults(snapshot.files).map((root) => ({ root, name: root })));
  for (const path of snapshot.files.keys()) {
    if (
      path.startsWith(".gitbin/") &&
      path !== metadataPath &&
      !/^\.gitbin\/(?:vaults\/[^/]+\/[a-f0-9-]{36}\.bin|blobs\/[^/]+\/[a-f0-9]{40})$/.test(path)
    )
      throw new Error("Invalid legacy storage path.");
  }
  for (const root of repositoryVaults(snapshot.files)) validateVault(snapshot.files, root);
}
