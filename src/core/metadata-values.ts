export type MetadataValue = {
  consolidationHash: string | null;
  appliedMigrations: readonly string[];
};
export function metadataValue(
  consolidationHash: string | null,
  appliedMigrations: readonly string[],
): MetadataValue {
  //@ verify
  //@ ensures \result.consolidationHash === consolidationHash && \result.appliedMigrations === appliedMigrations
  return { consolidationHash, appliedMigrations: [...appliedMigrations] };
}
