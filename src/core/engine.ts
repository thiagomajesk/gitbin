import { contentEqual, type FileContent } from "./content";
import { Effect } from "effect";
import { SyncError, attempt } from "./errors";
import { FileDocument } from "./file";
import {
  HistoryState,
  emptyHistory,
  recordHistory,
  snapshotFiles,
  snapshotUpdates,
  type HistoryEntry,
} from "./history";
import {
  attachFile,
  captureExisting,
  checkUnchanged,
  planWrites,
  projectFiles,
  validateRemote,
} from "./projection";
import type { GitRemote, LocalVault, RemoteSnapshot, SyncResult } from "./ports";
import {
  Journal,
  type Registration,
  type WriteIntent,
  decode,
  validPath,
  validateVaults,
} from "./protocol";

export interface SyncEngine {
  readonly vault: Registration;
  open(): Effect.Effect<void, SyncError>;
  capture(): Effect.Effect<boolean, SyncError>;
  rename(oldPath: string, path: string): Effect.Effect<void, SyncError>;
  sync(): Effect.Effect<SyncResult, SyncError>;
  history(): ReadonlyArray<HistoryEntry>;
  close(): void;
}

export function createSyncEngine(
  vault: Registration,
  local: LocalVault,
  remote: GitRemote,
): SyncEngine {
  const states = new Map<string, FileDocument>();
  let intents: ReadonlyArray<WriteIntent> = [];
  let history = emptyHistory();
  let historyDirty = false;

  const open = Effect.fn("engine.open")(function* () {
    const savedHistory = yield* local.loadHistory();
    if (savedHistory !== null) history = yield* decode(HistoryState, savedHistory);
    const raw = yield* local.load();
    if (raw === null) return;
    const journal = yield* decode(Journal, raw);
    if (journal.vaultRoot !== vault.root)
      return yield* new SyncError({
        message:
          "This local journal belongs to a different vault. Restore the previous connection before changing the vault name.",
      });
    yield* attempt("Cannot restore the local CRDT journal.", () => {
      for (const stored of journal.files) {
        if (states.has(stored.id)) throw new Error("Duplicate file ID.");
        states.set(stored.id, new FileDocument(stored.id, stored));
      }
      intents = journal.intents;
    });
  });

  const persist = () =>
    local.save({
      vaultRoot: vault.root,
      files: Array.from(states.values(), (file) => file.stored()),
      intents: intents,
    });

  const recover = Effect.fn("engine.recover")(function* () {
    for (const intent of intents) {
      if (!validPath(intent.path))
        return yield* new SyncError({ message: "Unsafe path in local write journal." });
      const current = yield* local.read(intent.path);
      if (!contentEqual(current, intent.after))
        yield* local.write(intent.path, intent.before, intent.after);
    }
    if (intents.length === 0) return;
    advanceBaselines();
    intents = [];
    yield* persist();
  });

  const advanceBaselines = (): void => {
    for (const file of states.values()) {
      const locations = file.locations();
      if (locations.length !== 1) continue;
      const location = locations[0]?.[1];
      if (location) file.materialized(location.path);
    }
  };

  const capture = Effect.fn("engine.capture")(function* () {
    yield* recover();
    const before = JSON.stringify(Array.from(states.values(), (file) => file.stored()));
    const files = yield* local.scan();
    yield* attempt("Could not capture saved vault edits.", () => {
      const tracked = new Set(Array.from(states.values(), (file) => file.baselinePath));
      for (const file of states.values()) captureExisting(file, files);
      for (const [path, text] of files) {
        if (!tracked.has(path)) attachFile(states, path, text);
      }
    });
    yield* persist();
    return before !== JSON.stringify(Array.from(states.values(), (file) => file.stored()));
  });

  const rename = Effect.fn("engine.rename")(function* (oldPath: string, path: string) {
    if (intents.length > 0)
      return yield* new SyncError({
        message: "Finish the interrupted sync before renaming tracked states.",
      });
    for (const file of states.values()) {
      const baseline = file.baselinePath;
      if (baseline === null || (baseline !== oldPath && !baseline.startsWith(`${oldPath}/`)))
        continue;
      const target = baseline === oldPath ? path : path + baseline.slice(oldPath.length);
      const text = yield* local.read(target);
      if (text === null) continue;
      yield* attempt("Cannot record this rename.", () => {
        file.captureContent(text);
        file.move(target);
        file.baselinePath = target;
      });
    }
    yield* persist();
  });

  const integrate = (snapshot: RemoteSnapshot): void => {
    validateVaults([...snapshot.vaults.filter((entry) => entry.root !== vault.root), vault]);
    validateRemote(snapshot);
    // Validate the entire projection before mutating local documents.
    for (const [id, update] of snapshot.states) {
      const file = states.get(id) ?? new FileDocument(id);
      file.merge(update);
      states.set(id, file);
    }
  };

  const initialize = Effect.fn("engine.initialize")(function* () {
    if (states.size > 0) return;
    const initial = yield* remote.read(vault);
    yield* attempt("Cannot import the remote vault.", () => integrate(initial));
    yield* persist();
  });

  const materialize = Effect.fn("engine.materialize")(function* (
    files: ReadonlyMap<string, FileContent>,
  ) {
    const localFiles = yield* local.scan();
    yield* attempt("Local vault changed during sync.", () =>
      checkUnchanged(states.values(), localFiles),
    );
    intents = yield* attempt("Cannot plan local writes.", () =>
      planWrites(states, files, localFiles),
    );
    yield* persist();
    if (intents.length > 0) {
      yield* recover();
      return;
    }
    advanceBaselines();
    yield* persist();
  });

  const sync = Effect.fn("engine.sync")(function* (): Effect.fn.Return<SyncResult, SyncError> {
    yield* initialize();
    yield* capture();
    const localBefore = snapshotFiles(states.values());
    for (let retry = 0; retry < 5; retry++) {
      const snapshot = yield* remote.read(vault);
      const incoming = snapshotUpdates(snapshot.states);
      yield* attempt("Cannot merge the remote vault.", () => integrate(snapshot));
      const projection = yield* attempt("Cannot project the merged vault.", () =>
        projectFiles(states.values()),
      );
      yield* persist();
      yield* materialize(projection.files);
      if (states.size === 0)
        return { published: true, revision: snapshot.revision, historyWarning: null };
      const published = yield* remote.publish(snapshot, {
        vault: vault,
        states: new Map(Array.from(states, ([id, file]) => [id, file.bytes()])),
        files: projection.files,
      });
      if (published.published) {
        const nextHistory = recordHistory(
          history,
          localBefore,
          incoming,
          snapshotFiles(states.values()),
          published.revision,
        );
        historyDirty ||= nextHistory !== history;
        history = nextHistory;
        const historyWarning = historyDirty
          ? yield* local.saveHistory(history).pipe(
              Effect.map(() => {
                historyDirty = false;
                return null;
              }),
              Effect.catch(() =>
                Effect.succeed("Sync completed, but its local history could not be saved."),
              ),
            )
          : null;
        return { published: true, revision: published.revision, historyWarning };
      }
    }
    return yield* new SyncError({
      message:
        "Main kept changing during publication. Your merged edits are saved locally; sync again.",
    });
  });

  const close = (): void => {
    for (const file of states.values()) file.destroy();
    states.clear();
  };
  return { vault, open, capture, rename, sync, close, history: () => history.entries };
}
