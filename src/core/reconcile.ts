import type { BinaryObjects } from "./blobs";
import type { CheckpointFile } from "./checkpoint";
import { contentEqual, contentHash, type FileContent } from "./content";
import { FileDocument } from "./file";
import type { RemoteSnapshot } from "./ports";

function pathOf(file: FileDocument): string | null {
  return file.locations().find(([, location]) => location.path !== null)?.[1].path ?? null;
}
function copyLocal(file: FileDocument, blobs: BinaryObjects): FileDocument {
  const copy = new FileDocument(crypto.randomUUID(), undefined, blobs);
  copy.edit(file.content);
  copy.move(pathOf(file));
  return copy;
}
function conflict<T>(local: T, incoming: T, base: T | undefined): boolean {
  return local !== base && incoming !== base && local !== incoming;
}
function replayDelete(remote: FileDocument, base: CheckpointFile | undefined): void {
  if (base && contentHash(remote.content) === base.hash && pathOf(remote) === base.path)
    remote.move(null);
}
function replayPresent(
  local: FileDocument,
  remote: FileDocument,
  base: CheckpointFile | undefined,
  blobs: BinaryObjects,
): FileDocument | null {
  const path = pathOf(local);
  const hash = contentHash(local.content);
  if (
    conflict(hash, contentHash(remote.content), base?.hash) ||
    conflict(path, pathOf(remote), base?.path)
  )
    return copyLocal(local, blobs);
  if (hash !== base?.hash) remote.edit(local.content);
  if (path !== base?.path) remote.move(path);
  return null;
}
function replay(
  local: FileDocument,
  remote: FileDocument | undefined,
  base: CheckpointFile | undefined,
  blobs: BinaryObjects,
): FileDocument | null {
  const path = pathOf(local);
  if (base && base.hash === contentHash(local.content) && base.path === path) return null;
  if (path === null) {
    if (remote) replayDelete(remote, base);
    return null;
  }
  return remote ? replayPresent(local, remote, base, blobs) : copyLocal(local, blobs);
}
function preserveBaseline(
  local: FileDocument,
  owner: FileDocument | undefined,
  next: Map<string, FileDocument>,
  blobs: BinaryObjects,
): void {
  if (owner) {
    owner.baselinePath = local.baselinePath;
    owner.baselineContent = local.baselineContent;
    // The on-disk bytes remain the baseline until the next materialization.
    owner.baselineState = null;
  } else if (local.baselinePath !== null) {
    const removed = new FileDocument(local.id, undefined, blobs);
    removed.move(null);
    removed.baselinePath = local.baselinePath;
    removed.baselineContent = local.baselineContent;
    next.set(removed.id, removed);
  }
}
/** Never merge Yjs updates from before a history reset into the new documents. */
export function reconcileConsolidation(
  states: ReadonlyMap<string, FileDocument>,
  snapshot: RemoteSnapshot,
  checkpoint: readonly CheckpointFile[] | null,
  blobs: BinaryObjects,
): Map<string, FileDocument> {
  const next = new Map<string, FileDocument>();
  try {
    for (const [id, bytes] of snapshot.states) {
      const file = new FileDocument(id, undefined, blobs);
      next.set(id, file);
      file.merge(bytes);
    }
    const incoming = new Map(next);
    const byPath = new Map([...incoming.values()].map((file) => [pathOf(file), file]));
    const baseline = new Map(checkpoint?.map((file) => [file.id, file]));
    for (const local of states.values()) {
      const base = baseline.get(local.id);
      const remote = incoming.get(local.id) ?? (base?.path ? byPath.get(base.path) : undefined);
      const extra = replay(local, remote, baseline.get(local.id), blobs);
      if (extra) next.set(extra.id, extra);
      preserveBaseline(local, extra ?? remote, next, blobs);
    }
    return next;
  } catch (error) {
    for (const file of next.values()) file.destroy();
    throw error;
  }
}

/** A write racing with materialization must not overwrite newly received content. */
export function captureRebasedEdit(
  file: FileDocument,
  disk: ReadonlyMap<string, FileContent>,
  states: Map<string, FileDocument>,
  blobs: BinaryObjects,
): boolean {
  if (file.baselineState !== null || file.baselinePath === null) return false;
  const value = disk.get(file.baselinePath);
  if (
    !value ||
    contentEqual(value, file.baselineContent) ||
    contentEqual(file.content, file.baselineContent)
  )
    return false;
  const copy = new FileDocument(crypto.randomUUID(), undefined, blobs);
  copy.edit(value);
  copy.move(file.baselinePath);
  copy.materialized(file.baselinePath);
  states.set(copy.id, copy);
  file.baselinePath = null;
  file.baselineContent = null;
  return true;
}
