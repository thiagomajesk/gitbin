import { Effect } from "effect";
import { type AvailabilityEntry, initialEntry } from "./availability";
import { rawContentKind } from "./content";
import { conflictingBinary } from "./download-decisions";
import { attempt, explain, SyncError } from "./errors";
import type { InventoryFile } from "./inventory";
import { mergeLocations, moveRecord, reconcileLocations } from "./locations";
import { stateLocation } from "./path-rules";
import { RawDocument } from "./raw-document";
import { createLocalEntry } from "./selective-capture";
import type { SelectiveContext } from "./selective-context";
import { admitDownload } from "./selective-download";
import type { InventorySnapshot } from "./selective-ports";
import { writeEntry } from "./selective-writes";

const preserveRecovery = Effect.fn("selective.preserveRecovery")(function* (
  ctx: SelectiveContext,
  entry: AvailabilityEntry,
) {
  const path = entry.localPath ?? entry.file.path ?? "File";
  const slash = path.lastIndexOf("/");
  const reference = entry.localContent ?? entry.file.content;
  const target =
    path.slice(0, slash + 1) +
    "Recovered " +
    entry.file.id.slice(0, 8) +
    "-" +
    reference.hash.slice(0, 8) +
    " " +
    path.slice(slash + 1);
  const existing = [...ctx.entries.values()].find(
    (value) => value.file.path === target && value.file.content.hash === reference.hash,
  );
  const bytes =
    (yield* ctx.local.object(reference, Infinity)) ??
    (yield* ctx.object(reference, ctx.limits().downloadBytes));
  const recovered = existing ?? (yield* createLocalEntry(ctx, target, bytes));
  yield* writeEntry(ctx, recovered, target, null, recovered.file.content, true);
});

const mergedContent = Effect.fn("selective.mergeContent")(function* (
  ctx: SelectiveContext,
  entry: AvailabilityEntry,
  incoming: InventoryFile,
) {
  yield* admitDownload(ctx, incoming);
  const remoteBytes = yield* ctx.object(incoming.state, Infinity);
  const localBytes = yield* ctx.object(entry.file.state, Infinity);
  const document = yield* attempt(
    "Cannot decode saved editing state.",
    () => new RawDocument(localBytes),
  );
  return yield* Effect.gen(function* () {
    yield* attempt("Cannot merge this file's content state.", () => document.merge(remoteBytes));
    const state = yield* ctx.stage(document.bytes());
    const binary = document.binaryReference();
    const kind = document.kind();
    const content = binary
      ? binary === incoming.content.hash
        ? incoming.content
        : entry.file.content
      : yield* ctx.stage(
          yield* attempt("Cannot materialize merged content. Original files were preserved.", () =>
            document.textBytes(),
          ),
        );
    yield* attempt("Merged content is inconsistent.", () => document.verify(content));
    return {
      state,
      content,
      kind,
      statePath: stateLocation(ctx.vault.root, entry.file.id, kind === "binary"),
    };
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        document.close();
      }),
    ),
  );
});

const rebaseContent = Effect.fn("selective.rebaseContent")(function* (
  ctx: SelectiveContext,
  entry: AvailabilityEntry,
  incoming: InventoryFile,
) {
  yield* admitDownload(ctx, incoming);
  const state = yield* ctx.object(incoming.state, Infinity);
  const bytes =
    (yield* ctx.local.object(entry.file.content, Infinity)) ??
    (yield* ctx.object(entry.file.content, ctx.limits().downloadBytes));
  const document = yield* attempt(
    "Cannot decode replacement editing state.",
    () => new RawDocument(state),
  );
  return yield* Effect.gen(function* () {
    const kind = rawContentKind(entry.localPath ?? incoming.path ?? "", bytes);
    yield* attempt("Cannot rebase saved content.", () => document.edit(bytes, kind));
    const next = yield* ctx.stage(document.bytes());
    entry.baselineState = next;
    return {
      ...incoming,
      state: next,
      kind,
      content: entry.file.content,
      statePath: stateLocation(ctx.vault.root, incoming.id, kind === "binary"),
    };
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        document.close();
      }),
    ),
  );
});

const chooseContent = Effect.fn("selective.chooseContent")(function* (
  ctx: SelectiveContext,
  entry: AvailabilityEntry,
  incoming: InventoryFile,
  consolidated: boolean,
) {
  const edited = entry.file.state.hash !== entry.base?.state.hash;
  const changed = incoming.state.hash !== entry.base?.state.hash;
  if (!edited || incoming.state.hash === entry.file.state.hash) return incoming;
  if (consolidated && incoming.content.hash === entry.base?.content.hash)
    return yield* rebaseContent(ctx, entry, incoming);
  else if (consolidated || binaryConflict(entry.file, incoming, changed)) {
    yield* preserveRecovery(ctx, entry);
    return incoming;
  }
  return { ...entry.file, ...(changed ? yield* mergedContent(ctx, entry, incoming) : {}) };
});
function binaryConflict(local: InventoryFile, incoming: InventoryFile, changed: boolean): boolean {
  return conflictingBinary(
    local.kind,
    incoming.kind,
    changed,
    local.content.hash === incoming.content.hash,
  );
}
const mergeEntry = Effect.fn("selective.mergeEntry")(function* (
  ctx: SelectiveContext,
  entry: AvailabilityEntry,
  incoming: InventoryFile,
  consolidated: boolean,
) {
  if (consolidated && entry.file.state.hash === entry.base?.state.hash) entry.baselineState = null;
  let file = yield* chooseContent(ctx, entry, incoming, consolidated);
  if (consolidated) {
    if (entry.file.path !== entry.base?.path)
      file = moveRecord(file, entry.file.path, entry.base?.content.hash ?? entry.file.content.hash);
  } else file = { ...file, locations: mergeLocations(entry.file, incoming) };
  entry.file = reconcileLocations(file);
  entry.base = incoming;
  entry.dirty = JSON.stringify(entry.file) !== JSON.stringify(incoming);
  entry.issue = null;
});

function adoptMatching(
  ctx: SelectiveContext,
  incoming: InventoryFile,
): AvailabilityEntry | undefined {
  const candidate = [...ctx.entries.values()].find(
    (entry) =>
      !entry.base &&
      entry.file.path === incoming.path &&
      entry.file.content.hash === incoming.content.hash,
  );
  if (!candidate) return undefined;
  ctx.entries.delete(candidate.file.id);
  candidate.file = incoming;
  candidate.base = incoming;
  candidate.baselineState = null;
  candidate.dirty = false;
  ctx.entries.set(incoming.id, candidate);
  return candidate;
}

function adoptReinitialized(
  ctx: SelectiveContext,
  incoming: InventoryFile,
  snapshot: InventorySnapshot,
): AvailabilityEntry | undefined {
  const candidates = [...ctx.entries.values()].filter(
    (entry) =>
      entry.base?.path !== null &&
      entry.base?.path === incoming.path &&
      entry.consolidationHash !== snapshot.consolidationHash &&
      !snapshot.inventory.files.some((file) => file.id === entry.file.id),
  );
  if (candidates.length !== 1) return undefined;
  const candidate = candidates[0];
  if (!candidate) return undefined;
  ctx.entries.delete(candidate.file.id);
  candidate.file = {
    ...candidate.file,
    id: incoming.id,
    statePath: stateLocation(ctx.vault.root, incoming.id, candidate.file.kind === "binary"),
  };
  ctx.entries.set(incoming.id, candidate);
  return candidate;
}

const integrateFile = Effect.fn("selective.integrateFile")(function* (
  ctx: SelectiveContext,
  incoming: InventoryFile,
  snapshot: InventorySnapshot,
) {
  const entry = findEntry(ctx, incoming, snapshot);
  if (!entry) {
    const fresh = initialEntry(incoming);
    fresh.consolidationHash = snapshot.consolidationHash;
    ctx.entries.set(incoming.id, fresh);
    return;
  }
  if (ctx.issues.has(entry.localPath ?? entry.file.path ?? entry.file.id)) return;
  ctx.protected.add(entry.file.id);
  yield* mergeEntry(
    ctx,
    entry,
    incoming,
    entry.consolidationHash !== snapshot.consolidationHash,
  ).pipe(
    Effect.tap(() =>
      Effect.sync(() => {
        entry.consolidationHash = snapshot.consolidationHash;
      }),
    ),
    Effect.catch((error) =>
      Effect.sync(() => {
        entry.issue = explain(error);
      }),
    ),
    Effect.ensuring(
      Effect.sync(() => {
        ctx.protected.delete(entry.file.id);
      }),
    ),
  );
});

export const integrateSelective = Effect.fn("selective.integrate")(function* (
  ctx: SelectiveContext,
  snapshot: InventorySnapshot,
) {
  const incomingIds = new Set(snapshot.inventory.files.map((file) => file.id));
  for (const incoming of snapshot.inventory.files) yield* integrateFile(ctx, incoming, snapshot);
  for (const entry of [...ctx.entries.values()]) {
    if (incomingIds.has(entry.file.id) || !entry.base) continue;
    if (entry.consolidationHash === snapshot.consolidationHash)
      return yield* new SyncError({
        message:
          "A tracked file disappeared from the repository inventory. Reinitialize the repository before syncing.",
      });
    if (entry.dirty && entry.file.path !== null) yield* preserveRecovery(ctx, entry);
    entry.file = moveRecord(entry.file, null);
    entry.base = null;
    entry.dirty = false;
  }
  ctx.consolidationHash = snapshot.consolidationHash;
  ctx.revision = snapshot.revision;
  yield* ctx.persist();
});

function findEntry(
  ctx: SelectiveContext,
  incoming: InventoryFile,
  snapshot: InventorySnapshot,
): AvailabilityEntry | undefined {
  return (
    ctx.entries.get(incoming.id) ??
    adoptReinitialized(ctx, incoming, snapshot) ??
    adoptMatching(ctx, incoming)
  );
}
