import { Effect } from "effect";
import { type AvailabilityEntry, initialEntry } from "./availability";
import { rawContentKind } from "./content";
import { attempt, explain, SyncError } from "./errors";
import { objectReference } from "./inventory";
import { moveRecord } from "./locations";
import { renamedPath, stateLocation } from "./path-rules";
import { RawDocument } from "./raw-document";
import type { SelectiveContext } from "./selective-context";
import { writeEntry } from "./selective-writes";

export const createLocalEntry = Effect.fn("selective.createLocal")(function* (
  ctx: SelectiveContext,
  path: string,
  bytes: Uint8Array,
) {
  const kind = rawContentKind(path, bytes);
  const document = new RawDocument();
  return yield* Effect.gen(function* () {
    yield* attempt("Cannot prepare this file for sync.", () => document.edit(bytes, kind));
    const content = yield* ctx.stage(bytes);
    const state = yield* ctx.stage(document.bytes());
    const id = crypto.randomUUID();
    const file = {
      id,
      path,
      kind,
      statePath: stateLocation(ctx.vault.root, id, kind === "binary"),
      state,
      content,
      locations: [{ id: crypto.randomUUID(), path, parents: [], contentHash: content.hash }],
    };
    const entry = initialEntry(file);
    Object.assign(entry, {
      base: null,
      localPath: path,
      localContent: content,
      baselineState: state,
      available: true,
      dirty: true,
      accessed: Date.now(),
    });
    ctx.entries.set(id, entry);
    yield* ctx.persist();
    return entry;
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        document.close();
      }),
    ),
  );
});

const captureContent = Effect.fn("selective.captureContent")(function* (
  ctx: SelectiveContext,
  entry: AvailabilityEntry,
  bytes: Uint8Array,
) {
  const baseline = entry.baselineState ?? entry.base?.state;
  if (!baseline)
    return yield* new SyncError({
      message: "The editing baseline is unavailable. Local bytes were preserved.",
    });
  const baselineBytes = yield* ctx.object(baseline, Infinity);
  const pending = yield* ctx.object(entry.file.state, Infinity);
  const [branch, merged] = yield* attempt("Cannot decode the saved editing baseline.", () => {
    const branch = new RawDocument(baselineBytes);
    try {
      return [branch, new RawDocument(pending)] as const;
    } catch (error) {
      branch.close();
      throw error;
    }
  });
  return yield* Effect.gen(function* () {
    const kind = rawContentKind(entry.localPath ?? "", bytes);
    yield* attempt("Cannot capture saved edits.", () => {
      branch.edit(bytes, kind);
      merged.merge(branch.bytes());
    });
    const localContent = yield* ctx.stage(bytes);
    const baselineState = yield* ctx.stage(branch.bytes());
    const binary = merged.binaryReference();
    const content = binary
      ? binary === localContent.hash
        ? localContent
        : entry.file.content
      : yield* ctx.stage(merged.textBytes());
    if (binary && binary !== content.hash)
      return yield* new SyncError({
        message: "The merged binary reference is unavailable. Local bytes were preserved.",
      });
    const state = yield* ctx.stage(merged.bytes());
    entry.file = {
      ...entry.file,
      state,
      content,
      kind,
      statePath: stateLocation(ctx.vault.root, entry.file.id, kind === "binary"),
    };
    entry.localContent = localContent;
    entry.baselineState = baselineState;
    entry.dirty = true;
    entry.issue = null;
    yield* ctx.persist();
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        branch.close();
        merged.close();
      }),
    ),
  );
});

const unexpectedWrite = Effect.fn("selective.unexpectedWrite")(function* (
  ctx: SelectiveContext,
  entry: AvailabilityEntry,
  path: string,
  bytes: Uint8Array,
) {
  const reference = objectReference(bytes);
  if (reference.hash === entry.file.content.hash) {
    entry.localContent = yield* ctx.stage(bytes);
    entry.available = true;
    entry.baselineState = null;
    yield* ctx.persist();
    return;
  }
  const slash = path.lastIndexOf("/");
  const recoveredPath =
    path.slice(0, slash + 1) +
    "Recovered " +
    crypto.randomUUID().slice(0, 8) +
    " " +
    path.slice(slash + 1);
  const recovered = yield* createLocalEntry(ctx, recoveredPath, bytes);
  recovered.localPath = null;
  yield* writeEntry(ctx, recovered, recoveredPath, null, recovered.file.content, true);
  const empty = yield* ctx.local.put(new Uint8Array());
  yield* writeEntry(ctx, entry, path, reference, empty, false);
});

const captureEntry = Effect.fn("selective.captureEntry")(function* (
  ctx: SelectiveContext,
  entry: AvailabilityEntry,
  files: ReadonlyMap<string, { bytes: number; modified: number }>,
) {
  const path = entry.localPath;
  if (!path) return;
  const stat = files.get(path);
  if (!stat) {
    entry.file = moveRecord(entry.file, null);
    entry.localPath = null;
    entry.localContent = null;
    entry.dirty = true;
    return;
  }
  if (!entry.available && stat.bytes === 0) return;
  const bytes = yield* ctx.local.read(path, Infinity);
  if (!bytes) return;
  if (!entry.available) {
    yield* unexpectedWrite(ctx, entry, path, bytes);
    return;
  }
  if (changedContent(entry, bytes)) yield* captureContent(ctx, entry, bytes);
  entry.modified = stat.modified;
});

function changedContent(entry: AvailabilityEntry, bytes: Uint8Array): boolean {
  return objectReference(bytes).hash !== entry.localContent?.hash;
}

function captureTargets(ctx: SelectiveContext, paths?: ReadonlySet<string>) {
  if (paths) for (const path of paths) ctx.issues.delete(path);
  else ctx.issues.clear();
  return [...ctx.entries.values()].filter(
    (entry) => !paths || (entry.localPath !== null && paths.has(entry.localPath)),
  );
}

export const captureSelective = Effect.fn("selective.capture")(function* (
  ctx: SelectiveContext,
  paths?: ReadonlySet<string>,
) {
  const entries = captureTargets(ctx, paths);
  const files = yield* ctx.local.list();
  const tracked = new Set(
    [...ctx.entries.values()].flatMap((entry) => (entry.localPath ? [entry.localPath] : [])),
  );
  let changed = false;
  for (const entry of entries) {
    const protectedBefore = ctx.protected.has(entry.file.id);
    ctx.protected.add(entry.file.id);
    yield* captureEntry(ctx, entry, files).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          entry.issue = explain(error);
          entry.dirty = true;
        }),
      ),
    );
    if (!protectedBefore) ctx.protected.delete(entry.file.id);
    changed ||= entry.dirty;
  }
  const untracked = [...files.keys()].filter(
    (path) => !tracked.has(path) && (!paths || paths.has(path)),
  );
  for (const path of untracked) {
    yield* Effect.gen(function* () {
      const bytes = yield* ctx.local.read(path, Infinity);
      if (bytes) {
        yield* createLocalEntry(ctx, path, bytes);
        changed = true;
      }
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          ctx.issues.set(path, explain(error));
        }),
      ),
    );
  }
  yield* ctx.persist();
  ctx.staging.clear();
  yield* ctx.collect();
  return changed;
});

export const renameSelective = Effect.fn("selective.rename")(function* (
  ctx: SelectiveContext,
  oldPath: string,
  path: string,
) {
  for (const entry of ctx.entries.values()) {
    const next = renamedPath(entry.localPath, oldPath, path);
    if (next === null) continue;
    entry.file = moveRecord(entry.file, next);
    entry.localPath = next;
    entry.dirty = true;
  }
  yield* ctx.persist();
});
