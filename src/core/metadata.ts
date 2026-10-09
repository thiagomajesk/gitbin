import { Schema } from "effect";
import { SyncError } from "./errors";

export const migrationIds = Object.freeze([
  "binary-content-references",
  "unified-metadata",
  "vault-storage",
]);
export const metadataPath = ".gitbin/metadata.json";
export const Metadata = Schema.Struct({
  consolidationHash: Schema.NullOr(Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/))),
  appliedMigrations: Schema.Array(Schema.NonEmptyString),
});
export type Metadata = typeof Metadata.Type;
export function currentMetadata(consolidationHash: string | null = null): Metadata {
  return { consolidationHash, appliedMigrations: [...migrationIds] };
}
export function migrationPrefix(applied: readonly string[], expected: readonly string[]): void {
  if (applied.some((id) => !expected.includes(id)))
    throw new SyncError({
      code: "newer-format",
      message: "This vault requires a newer Gitbin version.",
    });
  if (applied.some((id, index) => id !== expected[index]))
    throw new SyncError({
      code: "invalid-data",
      message: "The applied migration sequence is inconsistent.",
    });
}
export function readMetadata(raw: unknown, expected: readonly string[] = migrationIds): Metadata {
  let metadata: Metadata;
  try {
    metadata = Schema.decodeUnknownSync(Metadata, { onExcessProperty: "error" })(raw);
  } catch (cause) {
    throw new SyncError({ code: "invalid-data", message: "Invalid repository metadata.", cause });
  }
  migrationPrefix(metadata.appliedMigrations, expected);
  return metadata;
}
export function requireCurrentMetadata(raw: unknown): Metadata {
  if (raw === undefined) throw migrationRequired();
  const metadata = readMetadata(raw);
  if (metadata.appliedMigrations.length !== migrationIds.length) throw migrationRequired();
  return metadata;
}
function migrationRequired(): SyncError {
  return new SyncError({ code: "migration-required", message: "Storage migration required." });
}
