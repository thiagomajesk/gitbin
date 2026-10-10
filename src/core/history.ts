import { Schema } from "effect";
import { BinaryObjects } from "./blobs";
import { contentHash } from "./content";
import { describeChange } from "./decisions";
import { FileDocument } from "./file";
import { historyLocationOrder } from "./order-decisions";

const FileSnapshot = Schema.Struct({
  id: Schema.String,
  path: Schema.NullOr(Schema.String),
  text: Schema.NullOr(Schema.String),
  binary: Schema.Boolean,
  hash: Schema.String,
});
export type FileSnapshot = typeof FileSnapshot.Type;
const FileChange = Schema.Struct({
  kind: Schema.Literals(["combined", "local", "incoming", "synced"]),
  baseline: Schema.NullOr(FileSnapshot),
  local: Schema.NullOr(FileSnapshot),
  incoming: Schema.NullOr(FileSnapshot),
  result: FileSnapshot,
});
export type FileChange = typeof FileChange.Type;
const HistoryEntry = Schema.Struct({
  id: Schema.String,
  at: Schema.Number,
  revision: Schema.NullOr(Schema.String),
  baselineKnown: Schema.Boolean,
  changes: Schema.Array(FileChange),
});
export type HistoryEntry = typeof HistoryEntry.Type;
export const HistoryState = Schema.Struct({
  checkpoint: Schema.NullOr(Schema.Array(FileSnapshot)),
  entries: Schema.Array(HistoryEntry),
});
export type HistoryState = typeof HistoryState.Type;
export { emptyHistory } from "./history-values";

export function snapshotFiles(states: Iterable<FileDocument>): ReadonlyArray<FileSnapshot> {
  return Array.from(states, (file) => {
    const locations = [...file.locations()].sort(([a], [b]) => historyLocationOrder(a, b));
    const path = locations.find(([, location]) => location.path !== null)?.[1].path ?? null;
    const content = file.content;
    return {
      id: file.id,
      path,
      text: content.type === "text" ? content.value : null,
      binary: content.type === "binary",
      hash: contentHash(content),
    };
  });
}

export function snapshotUpdates(
  updates: ReadonlyMap<string, Uint8Array>,
  blobs = new BinaryObjects(),
): ReadonlyArray<FileSnapshot> {
  const states: FileDocument[] = [];
  try {
    for (const [id, bytes] of updates) {
      const file = new FileDocument(id, undefined, blobs);
      states.push(file);
      file.merge(bytes);
    }
    return snapshotFiles(states);
  } finally {
    for (const file of states) file.destroy();
  }
}

export function recordHistory(
  state: HistoryState,
  local: ReadonlyArray<FileSnapshot>,
  incoming: ReadonlyArray<FileSnapshot>,
  result: ReadonlyArray<FileSnapshot>,
  revision: string | null,
): HistoryState {
  const before = new Map(state.checkpoint?.map((file) => [file.id, file]));
  const own = new Map(local.map((file) => [file.id, file]));
  const remote = new Map(incoming.map((file) => [file.id, file]));
  const changes: FileChange[] = [];
  for (const file of result) {
    const change = describeChange(
      before.get(file.id) ?? null,
      own.get(file.id) ?? null,
      remote.get(file.id) ?? null,
      file,
      state.checkpoint !== null,
    );
    if (change) changes.push(change);
  }
  if (changes.length === 0) return state;
  const entries = [
    {
      id: crypto.randomUUID(),
      at: Date.now(),
      revision,
      baselineKnown: state.checkpoint !== null,
      changes,
    },
    ...state.entries,
  ].slice(0, 100);
  // Evict whole older entries, never portions of a comparison. Keep the newest sync intact.
  while (entries.length > 1 && JSON.stringify(entries).length > 2_500_000) entries.pop();
  return { checkpoint: result, entries };
}
