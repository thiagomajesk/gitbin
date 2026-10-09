import { BinaryObjects, binaryObject, blobId } from "../core/blobs";
import { FileDocument } from "../core/file";
import { binaryContent, contentFromBytes } from "../core/content";
import { statePath } from "../core/storage-layout";
import type { MigrationSnapshot } from "./types";
import { repositoryVaults, validateCurrent } from "./validation";

function vaultBlobs(source: MigrationSnapshot, root: string): BinaryObjects {
  const blobs = new BinaryObjects();
  for (const [path, bytes] of source.files) {
    if (path.startsWith(root + "/")) {
      const content = binaryContent(bytes);
      blobs.import(new Map([[blobId(content), content]]));
    } else if (path.startsWith(".gitbin/vaults/" + root + "/retained/")) {
      const id = path.slice(path.lastIndexOf("/") + 1);
      blobs.import(new Map([[id, binaryObject(id, bytes)]]));
    }
  }
  return blobs;
}
function compactFile(
  source: MigrationSnapshot,
  root: string,
  id: string,
  bytes: Uint8Array,
  blobs: BinaryObjects,
): readonly [string, Uint8Array] | null {
  const old = new FileDocument(id, undefined, blobs);
  const fresh = new FileDocument(id, undefined, blobs);
  try {
    old.merge(bytes);
    const locations = old.locations().filter(([, value]) => value.path !== null);
    if (locations.length > 1)
      throw new Error("Resolve conflicting file locations before consolidating.");
    const target = locations[0]?.[1].path;
    if (!target) return null;
    const content = source.files.get(root + "/" + target);
    if (!content) throw new Error("Missing committed file.");
    fresh.edit(contentFromBytes(target, content));
    fresh.move(target);
    const state = fresh.bytes();
    return [statePath(root, id, state), state];
  } finally {
    old.destroy();
    fresh.destroy();
  }
}
export function compactRepository(source: MigrationSnapshot): MigrationSnapshot {
  const files = new Map([...source.files].filter(([path]) => !path.startsWith(".gitbin/vaults/")));
  for (const root of repositoryVaults(source.files)) {
    const blobs = vaultBlobs(source, root);
    const records = [...source.files].filter(
      ([path]) => path.startsWith(".gitbin/vaults/" + root + "/") && path.endsWith(".bin"),
    );
    for (const [path, bytes] of records) {
      const result = compactFile(
        source,
        root,
        path.slice(path.lastIndexOf("/") + 1).slice(0, -4),
        bytes,
        blobs,
      );
      if (result) files.set(...result);
    }
  }
  const result = { ...source, files };
  validateCurrent(result);
  return result;
}
