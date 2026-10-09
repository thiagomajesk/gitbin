import { currentMetadata, metadataPath, migrationIds } from "../src/core/metadata";
import { attempt } from "../src/core/errors";
import * as Y from "yjs";
import { Effect, Schema } from "effect";
import { expect, it, vi } from "vitest";
import { createMigrationEngine, storageMigrations } from "../src/maintenance/engine";
import type { MigrationSnapshot, StorageMigration } from "../src/maintenance/types";
import { BinaryObjects, blobId } from "../src/core/blobs";
import { binaryContent, contentHash, encodeBytes } from "../src/core/content";
import { FileDocument } from "../src/core/file";
import { Journal } from "../src/core/protocol";
import { createSyncEngine } from "../src/core/engine";
import { MemoryVault } from "./helpers";

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Missing fixture value");
  return value;
}
function legacy() {
  const content = binaryContent(new Uint8Array([0, 1, 255]));
  const doc = new Y.Doc();
  doc.getMap("content").set("value", content);
  doc
    .getMap("locations")
    .set(crypto.randomUUID(), { path: "File.bin", parents: [], contentHash: contentHash(content) });
  const id = crypto.randomUUID();
  const path = ".gitbin/vaults/personal/" + id + ".bin";
  const repository: MigrationSnapshot = {
    kind: "repository",
    files: new Map([
      [path, Y.encodeStateAsUpdate(doc)],
      ["personal/File.bin", new Uint8Array([0, 1, 255])],
      ["unrelated.txt", new TextEncoder().encode("keep")],
    ]),
  };
  return { content, doc, id, path, repository };
}
it("migrates one isolated repository snapshot and preserves file identities and bytes while compacting CRDT state", async () => {
  const source = legacy();
  const original = source.repository.files.get(source.path)?.slice();
  const result = await Effect.runPromise(createMigrationEngine().prepare(source.repository));
  expect(source.repository.files.get(source.path)).toEqual(original);
  expect(source.repository.files.has(".gitbin/format")).toBe(false);
  expect(result.repository.files.get("unrelated.txt")).toEqual(new TextEncoder().encode("keep"));
  const objects = new BinaryObjects();
  objects.import(new Map([[blobId(source.content), source.content]]));
  const file = new FileDocument(source.id, undefined, objects);
  file.merge(
    required(
      result.repository.files.get(".gitbin/vaults/personal/attachments/" + source.id + ".bin"),
    ),
  );
  expect(file.content).toEqual(source.content);
  expect(Y.encodeStateVector(file.doc)).not.toEqual(Y.encodeStateVector(source.doc));
  expect(
    [...result.repository.files.keys()].some(
      (path) => path.includes("/retained/") || path.startsWith(".gitbin/blobs/"),
    ),
  ).toBe(false);
  file.destroy();
  source.doc.destroy();
});
it("migrates offline edits and interrupted writes only with a consolidated repository generation", async () => {
  const source = legacy();
  const baseline = encodeBytes(Y.encodeStateAsUpdate(source.doc));
  const changed = binaryContent(new Uint8Array([0, 77]));
  source.doc.getMap("content").set("value", changed);
  const original = {
    vaultRoot: "personal",
    files: [
      {
        id: source.id,
        state: encodeBytes(Y.encodeStateAsUpdate(source.doc)),
        baselineState: baseline,
        baselinePath: "File.bin",
        baselineContent: source.content,
      },
    ],
    intents: [{ path: "File.bin", before: source.content, after: changed }],
  };
  const device: MigrationSnapshot = {
    kind: "device",
    files: new Map([["journal.json", new TextEncoder().encode(JSON.stringify(original))]]),
  };
  const result = await Effect.runPromise(
    createMigrationEngine().prepare(source.repository, device),
  );
  const journal = Schema.decodeUnknownSync(Journal)(
    JSON.parse(new TextDecoder().decode(required(result.device).files.get("journal.json"))),
  );
  expect(journal.metadata.consolidationHash).toBeNull();
  const local = new MemoryVault();
  local.journal = journal;
  local.files.set("File.bin", source.content);
  for (const id of journal.blobs)
    local.blobs.set(id, binaryContent(required(required(result.device).files.get("blobs/" + id))));
  const engine = createSyncEngine({ name: "Personal", root: "personal" }, local, {
    read: () => Effect.die("Unexpected network"),
    publish: () => Effect.die("Unexpected publication"),
  });
  await Effect.runPromise(engine.open());
  await Effect.runPromise(engine.capture());
  expect(local.files.get("File.bin")).toEqual(changed);
  expect(local.journal?.intents).toEqual([]);
  engine.close();
  source.doc.destroy();
});

function metadata(snapshot: MigrationSnapshot) {
  return JSON.parse(new TextDecoder().decode(snapshot.files.get(metadataPath)));
}
it("rejects empty and duplicate registries, unknown migrations and inconsistent order", async () => {
  const source = legacy();
  const first = required(storageMigrations[0]);
  for (const registry of [[], [first, first], [{ ...first, id: "" }]]) {
    await expect(
      Effect.runPromise(createMigrationEngine(registry).prepare(source.repository)),
    ).rejects.toThrow();
  }
  for (const appliedMigrations of [
    ["unknown-migration"],
    ["unified-metadata"],
    [migrationIds[0], migrationIds[0]],
  ]) {
    const files = new Map(source.repository.files);
    files.set(
      metadataPath,
      new TextEncoder().encode(JSON.stringify({ consolidationHash: null, appliedMigrations })),
    );
    await expect(
      Effect.runPromise(createMigrationEngine().prepare({ kind: "repository", files })),
    ).rejects.toThrow();
  }
  source.doc.destroy();
});
it("does not trust unknown legacy versions during consolidation", async () => {
  await expect(
    Effect.runPromise(
      createMigrationEngine().prepare({
        kind: "repository",
        files: new Map([[".gitbin/format", new TextEncoder().encode("99\n")]]),
      }),
    ),
  ).rejects.toThrow();
});
it("rejects failed validation without changing source bytes", async () => {
  const source = legacy();
  const original = required(source.repository.files.get(source.path)).slice();
  const broken: StorageMigration = {
    ...required(storageMigrations[0]),
    transform: (snapshot) => {
      required(snapshot.files.get(source.path)).fill(0);
      return Effect.succeed(snapshot);
    },
  };
  await expect(
    Effect.runPromise(createMigrationEngine([broken]).prepare(source.repository)),
  ).rejects.toThrow();
  expect(source.repository.files.get(source.path)).toEqual(original);
  source.doc.destroy();
});
it("appends descriptive migrations in order and skips a satisfied transformation while validating it", async () => {
  const source = legacy();
  const transform = vi.fn((snapshot: MigrationSnapshot) => Effect.succeed(snapshot));
  const validate = vi.fn(() => Effect.void);
  const extra: StorageMigration = {
    id: "verify-existing-data",
    title: "Verify existing data",
    inspect: (snapshot) =>
      attempt("Inspection failed", () => {
        expect(metadata(snapshot).appliedMigrations).toEqual(migrationIds);
        return { status: "satisfied" as const };
      }),
    transform,
    validate,
  };
  const engine = createMigrationEngine([...storageMigrations, extra]);
  const result = await Effect.runPromise(engine.prepare(source.repository));
  expect(transform).not.toHaveBeenCalled();
  expect(validate).toHaveBeenCalledOnce();
  expect(metadata(result.repository).appliedMigrations).toEqual([...migrationIds, extra.id]);
  const again = await Effect.runPromise(engine.prepare(result.repository));
  expect(validate).toHaveBeenCalledOnce();
  expect(again.migrations).toEqual([]);
  expect(again.consolidationHash).not.toBe(result.consolidationHash);
  source.doc.destroy();
});
it("blocks without transforming or recording an unsatisfied migration", async () => {
  const source = legacy();
  const transform = vi.fn((snapshot: MigrationSnapshot) => Effect.succeed(snapshot));
  const blocked: StorageMigration = {
    id: "needs-manual-repair",
    title: "Repair",
    inspect: () => Effect.succeed({ status: "blocked", reason: "Missing source data" }),
    transform,
    validate: () => Effect.void,
  };
  await expect(
    Effect.runPromise(
      createMigrationEngine([...storageMigrations, blocked]).prepare(source.repository),
    ),
  ).rejects.toThrow("Missing source data");
  expect(transform).not.toHaveBeenCalled();
  expect(source.repository.files.has(metadataPath)).toBe(false);
  source.doc.destroy();
});
it("isolates inspection and validation mutations from the source and result", async () => {
  const source = legacy();
  const probe: StorageMigration = {
    id: "check-unrelated-file",
    title: "Check file",
    inspect: (snapshot) =>
      Effect.sync(() => {
        required(snapshot.files.get("unrelated.txt")).fill(0);
        return { status: "satisfied" as const };
      }),
    transform: () => Effect.die("Must skip"),
    validate: (snapshot) =>
      Effect.sync(() => {
        required(snapshot.files.get("unrelated.txt")).fill(0);
      }),
  };
  const result = await Effect.runPromise(
    createMigrationEngine([...storageMigrations, probe]).prepare(source.repository),
  );
  expect(new TextDecoder().decode(result.repository.files.get("unrelated.txt"))).toBe("keep");
  expect(new TextDecoder().decode(source.repository.files.get("unrelated.txt"))).toBe("keep");
  source.doc.destroy();
});
it("upgrades the previous binary-reference metadata without re-transforming content", async () => {
  const source = legacy();
  const first = await Effect.runPromise(createMigrationEngine().prepare(source.repository));
  const files = new Map(first.repository.files);
  files.delete(metadataPath);
  const attachmentPath = ".gitbin/vaults/personal/attachments/" + source.id + ".bin";
  files.set(source.path, required(files.get(attachmentPath)));
  files.delete(attachmentPath);
  files.set(".gitbin/blobs/personal/" + blobId(source.content), new Uint8Array([0, 1, 255]));
  files.set(".gitbin/format", new TextEncoder().encode("2\n"));
  files.set(".gitbin/generation", new TextEncoder().encode(crypto.randomUUID()));
  const transform = vi.fn(required(storageMigrations[0]).transform);
  const registry = [
    { ...required(storageMigrations[0]), transform },
    ...storageMigrations.slice(1),
  ];
  const result = await Effect.runPromise(
    createMigrationEngine(registry).prepare({ kind: "repository", files }),
  );
  expect(transform).not.toHaveBeenCalled();
  expect(result.repository.files.get(source.path)).toEqual(first.repository.files.get(source.path));
  expect(result.repository.files.has(".gitbin/format")).toBe(false);
  expect(result.repository.files.has(".gitbin/generation")).toBe(false);
  expect(metadata(result.repository)).toEqual(currentMetadata(result.consolidationHash));
  source.doc.destroy();
});

it("migrates a previous device journal without losing offline baselines or blob bytes", async () => {
  const source = legacy();
  const baseline = encodeBytes(Y.encodeStateAsUpdate(source.doc));
  const device: MigrationSnapshot = {
    kind: "device",
    files: new Map([
      [
        "journal.json",
        new TextEncoder().encode(
          JSON.stringify({
            vaultRoot: "personal",
            files: [
              {
                id: source.id,
                state: baseline,
                baselineState: baseline,
                baselinePath: "File.bin",
                baselineContent: source.content,
              },
            ],
            intents: [],
          }),
        ),
      ],
    ]),
  };
  const first = await Effect.runPromise(createMigrationEngine().prepare(source.repository, device));
  const files = new Map(required(first.device).files);
  const current = JSON.parse(new TextDecoder().decode(files.get("journal.json")));
  const { metadata: _metadata, ...data } = current;
  files.set(
    "journal.json",
    new TextEncoder().encode(
      JSON.stringify({ ...data, version: 2, generation: crypto.randomUUID() }),
    ),
  );
  const result = await Effect.runPromise(
    createMigrationEngine().prepare(first.repository, { kind: "device", files }),
  );
  const journal = Schema.decodeUnknownSync(Journal)(
    JSON.parse(new TextDecoder().decode(required(result.device).files.get("journal.json"))),
  );
  expect(journal.files).toEqual(current.files);
  expect(journal.metadata).toEqual(currentMetadata());
  expect(required(result.device).files.get("blobs/" + blobId(source.content))).toEqual(
    new Uint8Array([0, 1, 255]),
  );
  expect(files.get("journal.json")).not.toEqual(required(result.device).files.get("journal.json"));
  source.doc.destroy();
});
it("skips binary transformation when untracked repository data already satisfies it", async () => {
  const transform = vi.fn(required(storageMigrations[0]).transform);
  const result = await Effect.runPromise(
    createMigrationEngine([
      { ...required(storageMigrations[0]), transform },
      ...storageMigrations.slice(1),
    ]).prepare({ kind: "repository", files: new Map() }),
  );
  expect(transform).not.toHaveBeenCalled();
  expect(metadata(result.repository).appliedMigrations).toEqual(migrationIds);
});
