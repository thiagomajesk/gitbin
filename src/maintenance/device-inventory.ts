import { Schema } from "effect";
import {
  type AvailabilityEntry,
  type AvailabilityIntent,
  initialEntry,
} from "../core/availability";
import { BinaryObjects, binaryObject } from "../core/blobs";
import { contentBytes, decodeBytes, type FileContent } from "../core/content";
import { FileDocument } from "../core/file";
import { emptyHistory } from "../core/history";
import { type InventoryFile, objectReference } from "../core/inventory";
import { stateLocation } from "../core/path-rules";
import { Journal, type StoredFile } from "../core/protocol";
import { journalData } from "./metadata";
import type { MigrationSnapshot } from "./types";

function retain(files: Map<string, Uint8Array>, bytes: Uint8Array) {
  const reference = objectReference(bytes);
  files.set("objects/" + reference.hash, bytes);
  return reference;
}
function record(root: string, file: FileDocument, files: Map<string, Uint8Array>): InventoryFile {
  const locations = file.locations();
  if (locations.length !== 1)
    throw new Error("Resolve pending file locations before migrating this device.");
  const content = retain(files, contentBytes(file.content));
  const path = locations[0]?.[1].path ?? null;
  const kind = file.content.type;
  return {
    id: file.id,
    path,
    kind,
    statePath: stateLocation(root, file.id, kind === "binary"),
    state: retain(files, file.bytes()),
    content,
    locations: [{ id: locations[0]?.[0] ?? file.id, path, parents: [], contentHash: content.hash }],
  };
}
function convertFile(
  stored: StoredFile,
  journal: Journal,
  blobs: BinaryObjects,
  files: Map<string, Uint8Array>,
): AvailabilityEntry {
  const file = new FileDocument(stored.id, stored, blobs);
  const baseline = new FileDocument(stored.id, undefined, blobs);
  try {
    const current = record(journal.vaultRoot, file, files);
    const entry = initialEntry(current);
    if (stored.baselineState) {
      baseline.merge(decodeBytes(stored.baselineState));
      entry.base = record(journal.vaultRoot, baseline, files);
      entry.baselineState = entry.base.state;
    } else entry.base = null;
    entry.localPath = stored.baselinePath;
    entry.localContent = file.baselineContent
      ? retain(files, contentBytes(file.baselineContent))
      : null;
    entry.available = entry.localPath !== null && entry.localContent !== null;
    entry.dirty =
      !entry.base ||
      entry.base.state.hash !== current.state.hash ||
      entry.base.path !== current.path;
    entry.consolidationHash = journal.metadata.consolidationHash;
    return entry;
  } finally {
    file.destroy();
    baseline.destroy();
  }
}

export function migrateDeviceInventory(source: MigrationSnapshot): MigrationSnapshot {
  const journal = Schema.decodeUnknownSync(Journal)(journalData(source));
  const blobs = new BinaryObjects();
  for (const id of journal.blobs) {
    const bytes = source.files.get("blobs/" + id);
    if (!bytes) throw new Error("Missing saved attachment. Restore its backup before migrating.");
    blobs.import(new Map([[id, binaryObject(id, bytes)]]));
  }
  const files = new Map<string, Uint8Array>();
  const entries = journal.files.map((stored) => convertFile(stored, journal, blobs, files));
  const reference = (content: FileContent | null) =>
    content ? retain(files, contentBytes(content)) : null;
  const intents: AvailabilityIntent[] = journal.intents.map((intent) => {
    const entry = entries.find(
      (value) => value.localPath === intent.path || value.file.path === intent.path,
    );
    if (!entry)
      throw new Error(
        "An interrupted write has no file identity. Recover the write before migrating.",
      );
    return {
      id: entry.file.id,
      path: intent.path,
      before: reference(blobs.resolve(intent.before)),
      after: reference(blobs.resolve(intent.after)),
      available: intent.after !== null,
      baselineState: entry.file.state,
    };
  });
  files.set(
    "journal.json",
    new TextEncoder().encode(
      JSON.stringify({
        metadata: journal.metadata,
        vaultRoot: journal.vaultRoot,
        revision: null,
        entries,
        intents,
        history: emptyHistory(),
      }),
    ),
  );
  return { kind: "device", files };
}
