import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { Effect } from "effect";
import { attempt, SyncError } from "../core/errors";
import { migrationIds, migrationPrefix } from "../core/metadata";
import { binaryReferencesMigration } from "./binary-references";
import { compactRepository } from "./compact";
import { snapshotMetadata, stampMetadata } from "./metadata";
import type { ConsolidatedData, MigrationSnapshot, StorageMigration } from "./types";
import { unifiedMetadataMigration } from "./unified-metadata";
import { repositoryVaults, validateCurrent } from "./validation";
import { vaultStorageMigration } from "./vault-storage";

export const storageMigrations: readonly StorageMigration[] = Object.freeze([
  binaryReferencesMigration,
  unifiedMetadataMigration,
  vaultStorageMigration,
]);
function registryIds(registry: readonly StorageMigration[]): string[] {
  const ids = registry.map((step) => step.id);
  if (
    !ids.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !/^[a-z][a-z0-9-]*$/.test(id))
  )
    throw new Error("Migration registry must contain unique descriptive IDs.");
  // Runtime compatibility and migration execution must agree on the shipped sequence.
  if (registry === storageMigrations && JSON.stringify(ids) !== JSON.stringify(migrationIds))
    throw new Error("Migration registry does not match runtime compatibility checks.");
  return ids;
}
function clone(snapshot: MigrationSnapshot): MigrationSnapshot {
  return {
    ...snapshot,
    files: new Map([...snapshot.files].map(([path, bytes]) => [path, bytes.slice()])),
  };
}
const runStep = Effect.fn("migration.step")(function* (
  step: StorageMigration,
  source: MigrationSnapshot,
) {
  const inspection = yield* step.inspect(clone(source));
  if (inspection.status === "blocked")
    return yield* new SyncError({
      message: "Migration " + step.id + " is blocked: " + inspection.reason,
    });
  const result = inspection.status === "needed" ? yield* step.transform(clone(source)) : source;
  if (result.kind !== source.kind)
    return yield* new SyncError({ message: "Migration changed its snapshot kind." });
  yield* step.validate(clone(result));
  return result;
});
export function createMigrationEngine(registry: readonly StorageMigration[] = storageMigrations) {
  const migrate = Effect.fn("migration.transform")(function* (source: MigrationSnapshot) {
    const plan = yield* attempt("Cannot plan migrations.", () => {
      const ids = registryIds(registry);
      const metadata = snapshotMetadata(source, ids);
      const applied = metadata?.appliedMigrations ?? [];
      migrationPrefix(applied, ids);
      return { ids, applied, consolidationHash: metadata?.consolidationHash ?? null };
    });
    let result = clone(source);
    const steps: string[] = [];
    for (const [index, step] of registry.entries()) {
      if (index < plan.applied.length) continue;
      result = yield* runStep(step, result);
      result = yield* attempt("Cannot record migration.", () =>
        stampMetadata(result, {
          consolidationHash: plan.consolidationHash,
          appliedMigrations: plan.ids.slice(0, index + 1),
        }),
      );
      steps.push(step.title);
    }
    yield* attempt("Migrated data failed final validation.", () => validateCurrent(result));
    return { snapshot: result, steps };
  });
  const prepare = Effect.fn("migration.consolidate")(function* (
    repository: MigrationSnapshot,
    device: MigrationSnapshot | null = null,
  ): Effect.fn.Return<ConsolidatedData, SyncError> {
    if (repository.kind !== "repository" || (device && device.kind !== "device"))
      return yield* new SyncError({
        message: "Consolidation requires a repository and optional device snapshot.",
      });
    const migrated = yield* migrate(repository);
    const local = device ? yield* migrate(device) : null;
    return yield* attempt("Cannot finalize consolidation.", () => {
      const consolidationHash = bytesToHex(sha256(crypto.getRandomValues(new Uint8Array(32))));
      const ids = registryIds(registry);
      const metadata = { consolidationHash, appliedMigrations: ids };
      const result = stampMetadata(compactRepository(migrated.snapshot), metadata);
      return {
        repository: result,
        device: local ? local.snapshot : null,
        consolidationHash,
        migrations: [...new Set([...migrated.steps, ...(local?.steps ?? [])])],
        vaults: repositoryVaults(migrated.snapshot.files),
      };
    });
  });
  return { prepare };
}
