import { Schema } from "effect";
import * as Y from "yjs";
import { attempt } from "../core/errors";
import { BinaryObjects, StoredContent, binaryObject } from "../core/blobs";
import { contentBytes, decodeBytes, encodeBytes } from "../core/content";
import type { MigrationSnapshot, StorageMigration } from "./types";
import { validateCurrent } from "./legacy-validation";
import { currentMetadata, migrationIds } from "../core/metadata";
import {
  legacyVersion,
  normalizeLegacyMetadata,
  snapshotMetadata,
  stampMetadata,
} from "./metadata";

const LegacyContent = Schema.Struct({
  type: Schema.Literals(["text", "binary"]),
  value: Schema.String,
});
const MigrationContent = Schema.Union([LegacyContent, StoredContent]);
const LegacyJournal = Schema.Struct({
  vaultRoot: Schema.String,
  files: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      state: Schema.String,
      baselinePath: Schema.NullOr(Schema.String),
      baselineContent: Schema.NullOr(MigrationContent),
      baselineState: Schema.NullOr(Schema.String),
    }),
  ),
  intents: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      before: Schema.NullOr(MigrationContent),
      after: Schema.NullOr(MigrationContent),
    }),
  ),
});

function convertState(bytes: Uint8Array, objects: BinaryObjects): Uint8Array {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, bytes);
    const value = doc.getMap<unknown>("content").get("value");
    if (value !== undefined) {
      const content = Schema.decodeUnknownSync(Schema.Union([LegacyContent, StoredContent]))(value);
      if (content.type === "binary") {
        // Encoding migration preserves causal identities instead of creating a competing edit.
        Object.assign(value as object, objects.retain(content));
      }
    }
    return Y.encodeStateAsUpdate(doc);
  } finally {
    doc.destroy();
  }
}
function retainObjects(
  files: Map<string, Uint8Array>,
  prefix: string,
  objects: BinaryObjects,
  ids: readonly string[],
): void {
  for (const [id, content] of objects.select(ids)) files.set(prefix + id, contentBytes(content));
}
function stateReferences(bytes: Uint8Array): string[] {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, bytes);
    const raw = doc.getMap<unknown>("content").get("value");
    if (raw === undefined) return [];
    const value = Schema.decodeUnknownSync(StoredContent)(raw);
    return value.type === "binary-ref" ? [value.value] : [];
  } finally {
    doc.destroy();
  }
}
function repository(source: MigrationSnapshot): Map<string, Uint8Array> {
  const files = new Map(source.files);
  for (const [path, bytes] of source.files) {
    const match = /^\.gitbin\/vaults\/([^/]+)\/[a-f0-9-]{36}\.bin$/.exec(path);
    if (!match?.[1]) continue;
    const objects = sourceObjects(source, ".gitbin/blobs/" + match[1] + "/");
    const migrated = convertState(bytes, objects);
    files.set(path, migrated);
    retainObjects(files, ".gitbin/blobs/" + match[1] + "/", objects, stateReferences(migrated));
  }
  return files;
}
function device(source: MigrationSnapshot): Map<string, Uint8Array> {
  const legacy = Schema.decodeUnknownSync(LegacyJournal)(
    JSON.parse(new TextDecoder().decode(source.files.get("journal.json"))),
  );
  const objects = sourceObjects(source, "blobs/");
  const ids = new Set<string>();
  const state = (value: string) => {
    const bytes = convertState(decodeBytes(value), objects);
    for (const id of stateReferences(bytes)) ids.add(id);
    return encodeBytes(bytes);
  };
  const content = (value: typeof MigrationContent.Type | null) => {
    const stored = value?.type === "binary-ref" ? value : objects.retain(value);
    if (stored?.type === "binary-ref") ids.add(stored.value);
    return stored;
  };
  const files = legacy.files.map((file) => ({
    ...file,
    state: state(file.state),
    baselineState: file.baselineState === null ? null : state(file.baselineState),
    baselineContent: content(file.baselineContent),
  }));
  const intents = legacy.intents.map((intent) => ({
    ...intent,
    before: content(intent.before),
    after: content(intent.after),
  }));
  const result = new Map(source.files);
  result.set(
    "journal.json",
    new TextEncoder().encode(
      JSON.stringify({
        vaultRoot: legacy.vaultRoot,
        files,
        intents,
        blobs: [...ids],
      }),
    ),
  );
  retainObjects(result, "blobs/", objects, [...ids]);
  return result;
}

function sourceObjects(source: MigrationSnapshot, prefix: string): BinaryObjects {
  const objects = new BinaryObjects();
  for (const [path, bytes] of source.files) {
    if (!path.startsWith(prefix)) continue;
    const id = path.slice(prefix.length);
    objects.import(new Map([[id, binaryObject(id, bytes)]]));
  }
  return objects;
}
function validateBinaryData(source: MigrationSnapshot): void {
  validateCurrent(stampMetadata(normalizeLegacyMetadata(source), currentMetadata()));
}
export const binaryReferencesMigration = {
  id: "binary-content-references",
  title: "Store binary content as references",
  inspect: (source) =>
    attempt("Cannot inspect binary storage.", () => {
      if (!snapshotMetadata(source, migrationIds)) legacyVersion(source);
      try {
        validateBinaryData(source);
        return { status: "satisfied" as const };
      } catch {
        return { status: "needed" as const };
      }
    }),
  transform: (source) =>
    attempt("Binary migration failed; original data is unchanged.", () => ({
      kind: source.kind,
      files: source.kind === "repository" ? repository(source) : device(source),
    })),
  validate: (result) =>
    attempt("Migrated data failed validation.", () => validateBinaryData(result)),
} satisfies StorageMigration;
