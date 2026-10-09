import { Schema } from "effect";
import { type Metadata, metadataPath, readMetadata } from "../core/metadata";
import type { MigrationSnapshot } from "./types";

export function journalData(source: MigrationSnapshot): Record<string, unknown> {
  return Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(
    JSON.parse(new TextDecoder().decode(source.files.get("journal.json"))),
  );
}
export function snapshotMetadata(
  source: MigrationSnapshot,
  expected: readonly string[],
): Metadata | null {
  const bytes = source.files.get(metadataPath);
  const raw: unknown =
    source.kind === "device"
      ? journalData(source).metadata
      : bytes
        ? JSON.parse(new TextDecoder().decode(bytes))
        : undefined;
  return raw === undefined ? null : readMetadata(raw, expected);
}
export function legacyVersion(source: MigrationSnapshot): number {
  const raw =
    source.kind === "device" ? journalData(source).version : source.files.get(".gitbin/format");
  if (raw === undefined) return 1;
  const version = raw instanceof Uint8Array ? Number(new TextDecoder().decode(raw).trim()) : raw;
  if (version !== 1 && version !== 2)
    throw new Error("Unknown legacy storage version; update Gitbin before consolidating.");
  return version;
}
export function stampMetadata(source: MigrationSnapshot, metadata: Metadata): MigrationSnapshot {
  const files = new Map(source.files);
  if (source.kind === "repository") {
    files.set(metadataPath, new TextEncoder().encode(JSON.stringify(metadata)));
  } else {
    files.set(
      "journal.json",
      new TextEncoder().encode(JSON.stringify({ ...journalData(source), metadata })),
    );
  }
  return { ...source, files };
}
export function normalizeLegacyMetadata(source: MigrationSnapshot): MigrationSnapshot {
  const files = new Map(source.files);
  files.delete(".gitbin/format");
  files.delete(".gitbin/generation");
  if (source.kind === "device") {
    const { version: _version, generation: _generation, ...journal } = journalData(source);
    files.set("journal.json", new TextEncoder().encode(JSON.stringify(journal)));
  }
  return { ...source, files };
}
