import { Schema } from "effect";
import { HistoryState } from "./history";
import { InventoryFile, ObjectReference } from "./inventory";
import { Metadata } from "./metadata";

const Entry = Schema.Struct({
  file: InventoryFile,
  base: Schema.NullOr(InventoryFile),
  localPath: Schema.NullOr(Schema.String),
  localContent: Schema.NullOr(ObjectReference),
  baselineState: Schema.NullOr(ObjectReference),
  available: Schema.Boolean,
  dirty: Schema.Boolean,
  accessed: Schema.Number,
  modified: Schema.Number,
  issue: Schema.NullOr(Schema.String),
  consolidationHash: Schema.NullOr(Schema.String),
});
export type AvailabilityEntry = {
  -readonly [K in keyof typeof Entry.Type]: (typeof Entry.Type)[K];
};
const Intent = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  before: Schema.NullOr(ObjectReference),
  after: Schema.NullOr(ObjectReference),
  available: Schema.Boolean,
  baselineState: Schema.NullOr(ObjectReference),
});
export type AvailabilityIntent = typeof Intent.Type;
export const AvailabilityJournal = Schema.Struct({
  metadata: Metadata,
  vaultRoot: Schema.String,
  revision: Schema.NullOr(Schema.String),
  entries: Schema.Array(Entry),
  intents: Schema.Array(Intent),
  history: HistoryState,
});
export type AvailabilityJournal = typeof AvailabilityJournal.Type;

export function initialEntry(file: typeof InventoryFile.Type): AvailabilityEntry {
  return {
    file,
    base: file,
    localPath: null,
    localContent: null,
    baselineState: null,
    available: false,
    dirty: false,
    accessed: 0,
    modified: 0,
    issue: null,
    consolidationHash: null,
  };
}
