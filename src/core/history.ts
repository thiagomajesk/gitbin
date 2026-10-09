import { Schema } from "effect";
import { contentHash } from "./content";
import { BinaryObjects } from "./blobs";
import { FileDocument } from "./file";

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
export const emptyHistory = (): HistoryState => ({ checkpoint: null, entries: [] });

export function snapshotFiles(states: Iterable<FileDocument>): ReadonlyArray<FileSnapshot> {
  return Array.from(states, (file) => {
    const locations = [...file.locations()].sort(([a], [b]) => (a < b ? 1 : -1));
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

function same(left: FileSnapshot | null, right: FileSnapshot | null): boolean {
  if (!left || !right) return !left && !right;
  return left.path === right.path && left.hash === right.hash;
}

function changeKind(
  baseline: FileSnapshot | null,
  local: FileSnapshot | null,
  incoming: FileSnapshot | null,
  known: boolean,
): FileChange["kind"] {
  if (!known) return "synced";
  const localChanged = !same(baseline, local);
  const incomingChanged = !same(baseline, incoming);
  if (localChanged && incomingChanged && !same(local, incoming)) return "combined";
  return incomingChanged ? "incoming" : "local";
}

function describeChange(
  baseline: FileSnapshot | null,
  local: FileSnapshot | null,
  incoming: FileSnapshot | null,
  result: FileSnapshot,
  known: boolean,
): FileChange | null {
  if (known && same(baseline, result) && same(local, incoming)) return null;
  if (!known && result.path === null) return null;
  return { kind: changeKind(baseline, local, incoming, known), baseline, local, incoming, result };
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
