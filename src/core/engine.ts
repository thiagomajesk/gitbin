import { Effect } from "effect";
import { BinaryObjects } from "./blobs";
import type { CheckpointFile } from "./checkpoint";
import { contentEqual, type FileContent } from "./content";
import { attempt, SyncError } from "./errors";
import { FileDocument } from "./file";
import {
  emptyHistory,
  type HistoryEntry,
  HistoryState,
  recordHistory,
  snapshotFiles,
  snapshotUpdates,
} from "./history";
import { currentMetadata } from "./metadata";
import type { GitRemote, LocalVault, RemoteSnapshot, SyncResult } from "./ports";
import {
  attachFile,
  captureExisting,
  checkUnchanged,
  planWrites,
  projectFiles,
  validateRemote,
} from "./projection";
import { decode, type Registration, validateVaults, validPath, type WriteIntent } from "./protocol";
import { captureRebasedEdit, reconcileConsolidation } from "./reconcile";
import { decodeJournal } from "./storage-format";

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
  const blobs = new BinaryObjects();
  let intents: ReadonlyArray<WriteIntent> = [];
  let history = emptyHistory();
  let historyDirty = false;
  let consolidationHash: string | null = null;
  let checkpoint: readonly CheckpointFile[] | null = null;

  const open = Effect.fn("engine.open")(function* () {
    const savedHistory = yield* local.loadHistory();
    if (savedHistory !== null) history = yield* decode(HistoryState, savedHistory);
    const raw = yield* local.load();
    if (raw === null) return;
    const journal = yield* decodeJournal(raw);
    if (journal.vaultRoot !== vault.root)
      return yield* new SyncError({
        message:
          "This local journal belongs to a different vault. Restore the previous connection before changing the vault name.",
      });
    consolidationHash = journal.metadata.consolidationHash;
    checkpoint = journal.checkpoint;
    const savedBlobs = yield* local.loadBlobs(journal.blobs);
    yield* attempt("Cannot restore the local CRDT journal.", () => {
      blobs.import(savedBlobs);
      for (const stored of journal.files) {
        if (states.has(stored.id)) throw new Error("Duplicate file ID.");
        states.set(stored.id, new FileDocument(stored.id, stored, blobs));
      }
      intents = journal.intents.map((intent) => ({
        ...intent,
        before: blobs.resolve(intent.before),
        after: blobs.resolve(intent.after),
      }));
    });
  });

  const persist = Effect.fn("engine.persist")(function* () {
    const journal = yield* attempt("Cannot prepare the local journal.", () => {
      const files = Array.from(states.values(), (file) => file.stored());
      const savedIntents = intents.map((intent) => ({
        path: intent.path,
        before: blobs.retain(intent.before),
        after: blobs.retain(intent.after),
      }));
      const ids = new Set(Array.from(states.values()).flatMap((file) => file.binaryIds(true)));
      for (const content of [
        ...files.map((file) => file.baselineContent),
        ...savedIntents.flatMap((intent) => [intent.before, intent.after]),
      ])
        if (content?.type === "binary-ref") ids.add(content.value);
      return {
        metadata: currentMetadata(consolidationHash),
        checkpoint,
        vaultRoot: vault.root,
        blobs: [...ids],
        files,
        intents: savedIntents,
      };
    });
    const retained = yield* attempt("Missing journal binary content.", () =>
      blobs.select(journal.blobs),
    );
    // Durably save bytes before publishing references in the recoverable journal.
    yield* local.saveBlobs(retained);
    yield* local.save(journal);
    blobs.retainOnly(journal.blobs);
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
      for (const file of Array.from(states.values())) {
        if (!captureRebasedEdit(file, files, states, blobs)) captureExisting(file, files);
      }
      for (const [path, text] of files) {
        if (!tracked.has(path)) attachFile(states, path, text, blobs);
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
    blobs.import(snapshot.blobs ?? new Map());
    if (consolidationHash !== (snapshot.consolidationHash ?? null)) {
      const rebased = reconcileConsolidation(states, snapshot, checkpoint, blobs);
      for (const file of states.values()) file.destroy();
      states.clear();
      for (const [id, file] of rebased) states.set(id, file);
      checkpoint = snapshotUpdates(snapshot.states, blobs).map(({ id, path, hash }) => ({
        id,
        path,
        hash,
      }));
      history = emptyHistory();
      historyDirty = true;
      consolidationHash = snapshot.consolidationHash ?? null;
      return;
    }
    // Validate the entire projection before mutating local documents.
    for (const [id, update] of snapshot.states) {
      const file = states.get(id) ?? new FileDocument(id, undefined, blobs);
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

  const saveHistory = Effect.fn(function* (
    localBefore: ReadonlyArray<import("./history").FileSnapshot>,
    incoming: ReadonlyArray<import("./history").FileSnapshot>,
    revision: string | null,
  ) {
    const nextHistory = recordHistory(
      history,
      localBefore,
      incoming,
      snapshotFiles(states.values()),
      revision,
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
    return historyWarning;
  });

  const sync = Effect.fn("engine.sync")(function* (): Effect.fn.Return<SyncResult, SyncError> {
    yield* initialize();
    yield* capture();
    const localBefore = snapshotFiles(states.values());
    for (let retry = 0; retry < 5; retry++) {
      const snapshot = yield* remote.read(vault);
      const incomingBlobs = new BinaryObjects();
      const incoming = yield* attempt("Cannot read remote history.", () => {
        incomingBlobs.import(snapshot.blobs ?? new Map());
        return snapshotUpdates(snapshot.states, incomingBlobs);
      });
      yield* attempt("Cannot merge the remote vault.", () => integrate(snapshot));
      const projection = yield* attempt("Cannot project the merged vault.", () =>
        projectFiles(states.values()),
      );
      yield* persist();
      yield* materialize(projection.files);
      for (const [id, file] of states) {
        if (
          !snapshot.states.has(id) &&
          file.locations().every(([, location]) => location.path === null)
        ) {
          file.destroy();
          states.delete(id);
        }
      }
      yield* persist();
      if (states.size === 0)
        return { published: true, revision: snapshot.revision, historyWarning: null };
      const published = yield* remote.publish(snapshot, {
        vault: vault,
        states: new Map(Array.from(states, ([id, file]) => [id, file.bytes()])),
        files: projection.files,
        blobs: blobs.select(Array.from(states.values()).flatMap((file) => file.binaryIds())),
      });
      if (published.published) {
        checkpoint = snapshotFiles(states.values()).map(({ id, path, hash }) => ({
          id,
          path,
          hash,
        }));
        yield* persist();
        const historyWarning = yield* saveHistory(localBefore, incoming, published.revision);
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
