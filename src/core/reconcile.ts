import type { BinaryObjects } from "./blobs";
import type { CheckpointFile } from "./checkpoint";
import { contentEqual, contentHash, type FileContent } from "./content";
import { FileDocument } from "./file";
import type { RemoteSnapshot } from "./ports";
import { conflict, rebasedEdit, unchangedCheckpoint } from "./reconcile-decisions";

function pathOf(file: FileDocument): string | null {
  return file.locations().find(([, location]) => location.path !== null)?.[1].path ?? null;
}
function copyLocal(file: FileDocument, blobs: BinaryObjects): FileDocument {
  const copy = new FileDocument(crypto.randomUUID(), undefined, blobs);
  copy.edit(file.content);
  copy.move(pathOf(file));
  return copy;
}

function replayDelete(remote: FileDocument, base: CheckpointFile | undefined): void {
  if (!base) return;
  const hash = contentHash(remote.content);
  if (hash !== base.hash) return;
  if (unchangedCheckpoint(true, hash, base.hash, pathOf(remote), base.path)) remote.move(null);
}
function replayPresent(
  local: FileDocument,
  remote: FileDocument,
  base: CheckpointFile | undefined,
  blobs: BinaryObjects,
): FileDocument | null {
  const path = pathOf(local);
  const hash = contentHash(local.content);
  const baseline = base ?? { hash: null, path: null };
  if (
    conflict(hash, contentHash(remote.content), baseline.hash, base !== undefined) ||
    conflict(path, pathOf(remote), baseline.path, base !== undefined)
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
  if (base && unchangedCheckpoint(true, contentHash(local.content), base.hash, path, base.path))
    return null;
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
  const path = file.baselinePath;
  const value = file.baselineState === null && path !== null ? disk.get(path) : undefined;
  const diskMatches = value === undefined || contentEqual(value, file.baselineContent);
  const remoteMatches = diskMatches || contentEqual(file.content, file.baselineContent);
  if (
    !value ||
    !rebasedEdit(
      file.baselineState !== null,
      path !== null,
      value !== undefined,
      diskMatches,
      remoteMatches,
    )
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
