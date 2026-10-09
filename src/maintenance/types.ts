import type { Effect } from "effect";
import type { SyncError } from "../core/errors";

export interface MigrationSnapshot {
  readonly kind: "repository" | "device";
  readonly files: ReadonlyMap<string, Uint8Array>;
}
export type MigrationInspection =
  | { readonly status: "needed" | "satisfied" }
  | { readonly status: "blocked"; readonly reason: string };
/** All hooks receive isolated snapshots. Only consolidation publishes their results. */
export interface StorageMigration {
  readonly id: string;
  readonly title: string;
  readonly inspect: (source: MigrationSnapshot) => Effect.Effect<MigrationInspection, SyncError>;
  readonly transform: (source: MigrationSnapshot) => Effect.Effect<MigrationSnapshot, SyncError>;
  readonly validate: (result: MigrationSnapshot) => Effect.Effect<void, SyncError>;
}
export interface ConsolidatedData {
  readonly repository: MigrationSnapshot;
  readonly device: MigrationSnapshot | null;
  readonly consolidationHash: string;
  readonly migrations: readonly string[];
  readonly vaults: readonly string[];
}
