import type { Effect } from "effect";
import type { AvailabilityJournal } from "./availability";
import type { SyncError } from "./errors";
import type { Inventory, InventoryFile, ObjectReference } from "./inventory";
import type { Registration } from "./protocol";

export interface FileStat {
  readonly bytes: number;
  readonly modified: number;
}
export interface DeviceLimits {
  readonly downloadBytes: number;
  readonly storageBytes: number | "unlimited";
  readonly mode: "on-demand" | "all";
}
export interface SelectiveVault {
  list(): Effect.Effect<ReadonlyMap<string, FileStat>, SyncError>;
  read(path: string, limit: number): Effect.Effect<Uint8Array | null, SyncError>;
  write(
    path: string,
    before: ObjectReference | null,
    after: Uint8Array | null,
    unload?: boolean,
  ): Effect.Effect<void, SyncError>;
  load(): Effect.Effect<unknown, SyncError>;
  save(journal: AvailabilityJournal): Effect.Effect<void, SyncError>;
  put(bytes: Uint8Array): Effect.Effect<ObjectReference, SyncError>;
  object(reference: ObjectReference, limit: number): Effect.Effect<Uint8Array | null, SyncError>;
  objects(): Effect.Effect<ReadonlyMap<string, number>, SyncError>;
  hasObject(reference: ObjectReference): Effect.Effect<boolean, SyncError>;
  removeObject(hash: string): Effect.Effect<void, SyncError>;
  usage(): Effect.Effect<number, SyncError>;
  active(path: string): boolean;
  changed(): void;
}
export interface InventorySnapshot {
  readonly revision: string | null;
  readonly consolidationHash: string | null;
  readonly vaults: readonly Registration[];
  readonly inventory: Inventory;
}
export interface SelectiveRemote {
  read(vault: Registration): Effect.Effect<InventorySnapshot, SyncError>;
  object(reference: ObjectReference, limit: number): Effect.Effect<Uint8Array, SyncError>;
  put(bytes: Uint8Array): Effect.Effect<ObjectReference, SyncError>;
  publish(
    base: InventorySnapshot,
    vault: Registration,
    files: readonly InventoryFile[],
  ): Effect.Effect<{ published: boolean; revision: string | null }, SyncError>;
  release(hash: string): Effect.Effect<void, SyncError>;
  clear(): Effect.Effect<void, SyncError>;
}
