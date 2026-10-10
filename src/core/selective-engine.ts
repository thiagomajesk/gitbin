import { Effect, Schema } from "effect";
import { reportProgress } from "./activity";
import { AvailabilityJournal } from "./availability";
import { attempt, explain, SyncError } from "./errors";
import { emptyHistory, type FileSnapshot, recordHistory } from "./history";
import { validateInventory } from "./inventory";
import { requireCurrentMetadata } from "./metadata";
import { type Registration, validPath } from "./protocol";
import { captureSelective, renameSelective } from "./selective-capture";
import { createSelectiveContext } from "./selective-context";
import { historyCached, inventorySnapshots, loadHistoryChange } from "./selective-history";
import { loadEntryContent, materializeSelective } from "./selective-materialize";
import { integrateSelective } from "./selective-merge";
import type { DeviceLimits, SelectiveRemote, SelectiveVault } from "./selective-ports";
import { publishSelective } from "./selective-publish";
import { recoverWrites, writeEntry } from "./selective-writes";

export function createSelectiveEngine(
  vault: Registration,
  local: SelectiveVault,
  remote: SelectiveRemote,
  limits: () => DeviceLimits,
) {
  const ctx = createSelectiveContext(vault, local, remote, limits);
  const open = Effect.fn("selective.open")(function* () {
    const raw = yield* local.load();
    if (raw !== null) {
      const journal = yield* attempt("Cannot restore download availability.", () => {
        const envelope = Schema.decodeUnknownSync(Schema.Struct({ metadata: Schema.Unknown }))(raw);
        requireCurrentMetadata(envelope.metadata);
        const value = Schema.decodeUnknownSync(AvailabilityJournal, { onExcessProperty: "error" })(
          raw,
        );
        if (value.vaultRoot !== vault.root)
          throw new Error("Availability belongs to another vault.");
        return value;
      });
      for (const entry of journal.entries) {
        yield* attempt("Invalid saved file identity.", () => {
          if (ctx.entries.has(entry.file.id)) throw new Error("Duplicate saved identity.");
          validateInventory({ files: [entry.file] }, vault.root);
          if (entry.base) validateInventory({ files: [entry.base] }, vault.root);
          if (entry.localPath !== null && !validPath(entry.localPath))
            throw new Error("Unsafe local path.");
        });
        ctx.entries.set(entry.file.id, { ...entry });
      }
      yield* attempt("Invalid interrupted write.", () => {
        for (const intent of journal.intents) {
          if (!ctx.entries.has(intent.id) || !validPath(intent.path))
            throw new Error("Invalid write identity or path.");
        }
      });
      ctx.intents = journal.intents;
      ctx.revision = journal.revision;
      ctx.consolidationHash = journal.metadata.consolidationHash;
      ctx.history = journal.history;
      yield* recoverWrites(ctx);
    }
    ctx.ready = true;
    ctx.usage = yield* local.usage();
    local.changed();
  });
  const capture = Effect.fn("selective.captureSaved")(function* (paths?: ReadonlySet<string>) {
    if (!ctx.ready) return false;
    yield* recoverWrites(ctx);
    return yield* captureSelective(ctx, paths);
  });
  const sync = Effect.fn("selective.sync")(function* () {
    if (!ctx.ready)
      return yield* new SyncError({ message: "Download availability has not been restored." });
    yield* reportProgress("Checking local changes…");
    yield* capture();
    const own = inventorySnapshots([...ctx.entries.values()].map((entry) => entry.file));
    let incoming: FileSnapshot[] | undefined;
    for (let retry = 0; retry < 10; retry++) {
      yield* reportProgress("Checking remote changes…");
      const snapshot = yield* remote.read(vault);
      yield* reportProgress(
        "Remote inventory checked",
        "Revision: " + (snapshot.revision?.slice(0, 8) ?? "Empty repository"),
      );
      if (snapshot.consolidationHash !== ctx.consolidationHash) ctx.history = emptyHistory();
      incoming ??= inventorySnapshots(snapshot.inventory.files);
      yield* reportProgress("Merging changes…");
      yield* integrateSelective(ctx, snapshot);
      yield* reportProgress("Applying changes…");
      yield* materializeSelective(ctx);
      const result = yield* publishSelective(ctx, snapshot);
      if (!result.published) continue;
      if (result.count > 0) continue;
      ctx.staging.clear();
      yield* ctx.collect();
      ctx.history = recordHistory(
        ctx.history,
        own,
        incoming,
        inventorySnapshots(snapshot.inventory.files),
        ctx.revision,
      );
      yield* ctx.reserve(0);
      yield* ctx.persist();
      yield* reportProgress("Sync checkpoint saved");
      return {
        published: true,
        snapshot,
        revision: ctx.revision,
        pending: [...ctx.entries.values()].some((entry) => entry.dirty) || ctx.issues.size > 0,
        historyWarning: null,
      };
    }
    return {
      published: true,
      snapshot: null,
      revision: ctx.revision,
      pending: true,
      historyWarning: "More changes are waiting for the next sync.",
    };
  });
  const hydrate = Effect.fn("selective.download")(function* (path: string) {
    const entry = [...ctx.entries.values()].find((value) => value.file.path === path);
    if (!entry || !ctx.ready)
      return yield* new SyncError({
        message: "Sync the file inventory before downloading this file.",
      });
    ctx.protected.add(entry.file.id);
    return yield* Effect.gen(function* () {
      yield* recoverWrites(ctx);
      yield* captureSelective(ctx, new Set([path]));
      const reference = yield* loadEntryContent(ctx, entry);
      yield* writeEntry(ctx, entry, path, entry.localContent, reference, true);
      entry.accessed = Date.now();
      yield* ctx.persist();
      yield* reportProgress("File ready", entry.file.content.bytes.toLocaleString() + " bytes");
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          ctx.protected.delete(entry.file.id);
          ctx.staging.clear();
        }),
      ),
    );
  });
  const download = (path: string) =>
    hydrate(path).pipe(
      Effect.catch((error) =>
        Effect.gen(function* () {
          const entry = [...ctx.entries.values()].find((value) => value.file.path === path);
          if (entry) {
            entry.issue = explain(error);
            yield* ctx.persist();
          }
          return yield* error;
        }),
      ),
    );
  const status = (path: string): string | null => {
    if (!ctx.ready) return "Restoring download availability…";
    const entry = [...ctx.entries.values()].find(
      (value) => value.localPath === path || value.file.path === path,
    );
    if (!entry || entry.available) return null;
    if (entry.issue) return entry.issue;
    const cap = limits().downloadBytes;
    return entry.file.content.bytes > cap
      ? "This file exceeds the max download size. Increase the limit in Settings, then try again."
      : "Not downloaded. Open this file while connected to download it.";
  };
  return {
    vault,
    open,
    capture,
    sync,
    download,
    status,
    rename: (oldPath: string, path: string) => renameSelective(ctx, oldPath, path),
    details: () => ({
      used: ctx.usage,
      limit: limits().storageBytes,
      entries: [...ctx.entries.values()],
      issues: [...ctx.issues],
    }),
    history: () => ctx.history.entries,
    historyChange: (change: Parameters<typeof loadHistoryChange>[1], online?: () => boolean) =>
      loadHistoryChange(ctx, change, online),
    historyCached: (change: Parameters<typeof historyCached>[1]) => historyCached(ctx, change),
    close: () => {
      ctx.ready = false;
      ctx.entries.clear();
      ctx.protected.clear();
      ctx.staging.clear();
    },
  };
}
export type SelectiveEngine = ReturnType<typeof createSelectiveEngine>;
