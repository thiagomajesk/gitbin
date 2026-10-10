import { Effect } from "effect";
import type { AvailabilityEntry } from "./availability";
import { SyncError } from "./errors";
import type { ObjectReference } from "./inventory";
import type { SelectiveContext } from "./selective-context";
import type { InventorySnapshot } from "./selective-ports";

function changedObjects(entry: AvailabilityEntry): readonly ObjectReference[] {
  const result: ObjectReference[] = [];
  if (entry.file.state.hash !== entry.base?.state.hash) result.push(entry.file.state);
  if (entry.file.content.hash !== entry.base?.content.hash) result.push(entry.file.content);
  return result;
}

function batch(ctx: SelectiveContext, snapshot: InventorySnapshot) {
  const files = new Map(snapshot.inventory.files.map((file) => [file.id, file]));
  const entries: AvailabilityEntry[] = [];
  const objects = new Map<string, ObjectReference>();
  let bytes = 0;
  for (const entry of ctx.entries.values()) {
    if (!entry.dirty) continue;
    const changed = changedObjects(entry);
    if (entry.issue && changed.length > 0) continue;
    const extra = changed
      .filter((reference) => !objects.has(reference.hash))
      .reduce((sum, reference) => sum + reference.bytes, 0);
    bytes += extra;
    for (const reference of changed) objects.set(reference.hash, reference);
    files.set(entry.file.id, entry.file);
    entries.push(entry);
  }
  return { files: [...files.values()], entries, objects: [...objects.values()], bytes };
}

export const publishSelective = Effect.fn("selective.publishBatch")(function* (
  ctx: SelectiveContext,
  snapshot: InventorySnapshot,
) {
  const next = batch(ctx, snapshot);
  if (next.entries.length === 0) return { published: true, revision: snapshot.revision, count: 0 };
  yield* ctx.reserve(
    next.bytes * 2 + new TextEncoder().encode(JSON.stringify(next.files)).length * 2 + 65536,
  );
  ctx.transportPinned = true;
  return yield* Effect.gen(function* () {
    for (const reference of next.objects) {
      const bytes = yield* ctx.local.object(reference, reference.bytes);
      if (!bytes)
        return yield* new SyncError({
          message:
            "Pending content is missing from local storage. Existing files and recovery metadata were preserved.",
        });
      yield* ctx.remote.put(bytes);
    }
    const result = yield* ctx.remote.publish(snapshot, ctx.vault, next.files);
    if (result.published) {
      for (const entry of next.entries) {
        entry.base = entry.file;
        entry.consolidationHash = snapshot.consolidationHash;
        entry.dirty = entry.issue !== null && entry.available;
      }
      ctx.revision = result.revision;
      yield* ctx.persist();
      for (const reference of next.objects) yield* ctx.remote.release(reference.hash);
    }
    return { ...result, count: next.entries.length };
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        ctx.transportPinned = false;
      }),
    ),
  );
});
