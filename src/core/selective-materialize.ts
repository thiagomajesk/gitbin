import { Effect } from "effect";
import type { AvailabilityEntry, AvailabilityIntent } from "./availability";
import { attempt, explain, type SyncError } from "./errors";
import type { ObjectReference } from "./inventory";
import { moveRecord, reconcileLocations } from "./locations";
import { overlaps } from "./path-rules";
import { availablePath } from "./projection";
import { RawDocument } from "./raw-document";
import type { SelectiveContext } from "./selective-context";
import { admitDownload, reserveDownload } from "./selective-download";
import { recoverWrites } from "./selective-writes";

export const loadEntryContent = Effect.fn("selective.loadContent")(function* (
  ctx: SelectiveContext,
  entry: AvailabilityEntry,
) {
  yield* admitDownload(ctx, entry.file);
  yield* reserveDownload(ctx, entry.file);
  const state = yield* ctx.object(entry.file.state, Infinity);
  yield* attempt("File content and editing state disagree. Reinitialize the repository.", () => {
    const document = new RawDocument(state);
    try {
      document.verify(entry.file.content);
    } finally {
      document.close();
    }
  });
  yield* ctx.object(entry.file.content, Infinity);
  yield* ctx.reserve(entry.file.content.bytes + 1024);
  entry.issue = null;
  return entry.file.content;
});

function resolvePaths(ctx: SelectiveContext): void {
  const owners = new Set<string>();
  for (const entry of [...ctx.entries.values()].sort((a, b) =>
    a.file.id.localeCompare(b.file.id),
  )) {
    if (entry.issue && entry.dirty) continue;
    entry.file = reconcileLocations(entry.file);
    if (entry.file.path === null) continue;
    const target = availablePath(entry.file.path, entry.file.id, owners);
    if (target !== entry.file.path) {
      entry.file = moveRecord(entry.file, target);
      entry.dirty = true;
    }
    owners.add(target.toLowerCase());
  }
}

interface Desired {
  entry: AvailabilityEntry;
  path: string;
  reference: ObjectReference;
  available: boolean;
  baselineState: ObjectReference | null;
}
function wanted(ctx: SelectiveContext, entry: AvailabilityEntry): boolean {
  return (
    entry.available ||
    ctx.limits().mode === "all" ||
    (entry.file.path !== null && ctx.local.active(entry.file.path))
  );
}
const prepareWanted = Effect.fn("selective.prepareWanted")(function* (
  ctx: SelectiveContext,
  entries: readonly AvailabilityEntry[],
) {
  const loaded = new Set<string>();
  for (const entry of entries) {
    if (entry.available && entry.localContent?.hash === entry.file.content.hash) continue;
    yield* loadEntryContent(ctx, entry).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          loaded.add(entry.file.id);
        }),
      ),
      Effect.catch((error) =>
        Effect.sync(() => {
          entry.issue = explain(error);
        }),
      ),
    );
  }
  return loaded;
});
const desiredFile = Effect.fn("selective.desiredFile")(function* (
  ctx: SelectiveContext,
  entry: AvailabilityEntry,
  loaded: ReadonlySet<string>,
): Effect.fn.Return<Desired | null, SyncError> {
  const path = entry.file.path;
  if (path === null || (entry.issue && entry.dirty)) return null;
  if (loaded.has(entry.file.id))
    return {
      entry,
      path,
      reference: entry.file.content,
      available: true,
      baselineState: entry.file.state,
    };
  if (entry.available && entry.localContent)
    return {
      entry,
      path,
      reference: entry.localContent,
      available: true,
      baselineState: entry.baselineState,
    };
  return {
    entry,
    path,
    reference: yield* ctx.local.put(new Uint8Array()),
    available: false,
    baselineState: null,
  };
});

function plan(ctx: SelectiveContext, desired: readonly Desired[]): AvailabilityIntent[] {
  const owners = localOwners(ctx);
  const targets = new Set(desired.map((value) => value.path));
  const writes: AvailabilityIntent[] = [];
  for (const target of desired) {
    const before = owners.get(target.path)?.localContent ?? null;
    if (alreadyWritten(before, target)) {
      target.entry.available = target.available;
      target.entry.baselineState = target.baselineState;
      continue;
    }
    writes.push({
      id: target.entry.file.id,
      path: target.path,
      before,
      after: target.reference,
      available: target.available,
      baselineState: target.baselineState,
    });
  }
  for (const [path, entry] of owners) {
    if (targets.has(path) || (entry.issue && entry.dirty)) continue;
    writes.push({
      id: entry.file.id,
      path,
      before: entry.localContent,
      after: null,
      available: false,
      baselineState: null,
    });
  }
  return orderWrites(writes, [...owners.keys()]);
}
function alreadyWritten(before: ObjectReference | null, target: Desired): boolean {
  return before?.hash === target.reference.hash && target.entry.localPath === target.path;
}
function localOwners(ctx: SelectiveContext): Map<string, AvailabilityEntry> {
  return new Map(
    [...ctx.entries.values()].flatMap((entry) =>
      entry.localPath ? [[entry.localPath, entry] as const] : [],
    ),
  );
}
function orderWrites(writes: AvailabilityIntent[], paths: string[]): AvailabilityIntent[] {
  const blocked = (intent: AvailabilityIntent) =>
    intent.after !== null &&
    paths.some(
      (path) => path !== intent.path && overlaps(path.toLowerCase(), intent.path.toLowerCase()),
    );
  return [
    ...writes.filter((value) => value.after !== null && !blocked(value)),
    ...writes.filter((value) => value.after === null),
    ...writes.filter(blocked),
  ];
}

export const materializeSelective = Effect.fn("selective.materialize")(function* (
  ctx: SelectiveContext,
) {
  yield* attempt("Cannot resolve file locations.", () => resolvePaths(ctx));
  const requested = [...ctx.entries.values()].filter(
    (entry) => entry.file.path !== null && wanted(ctx, entry) && !(entry.issue && entry.dirty),
  );
  const protectedIds = requested
    .filter((entry) => !ctx.protected.has(entry.file.id))
    .map((entry) => entry.file.id);
  for (const id of protectedIds) ctx.protected.add(id);
  return yield* Effect.gen(function* () {
    const loaded = yield* prepareWanted(ctx, requested);
    const desired: Desired[] = [];
    for (const entry of ctx.entries.values()) {
      const target = yield* desiredFile(ctx, entry, loaded);
      if (target) desired.push(target);
    }
    ctx.intents = [...ctx.intents, ...plan(ctx, desired)];
    yield* ctx.persist();
    yield* recoverWrites(ctx);
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        for (const id of protectedIds) ctx.protected.delete(id);
      }),
    ),
  );
});
