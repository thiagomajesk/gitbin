import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { AvailabilityJournal, initialEntry } from "../src/core/availability";
import { emptyHistory } from "../src/core/history";
import { decodeInventory, inventoryPath, objectReference } from "../src/core/inventory";
import { metadataPath, migrationIds, requireCurrentMetadata } from "../src/core/metadata";
import { createSelectiveEngine } from "../src/core/selective-engine";
import { createMigrationEngine } from "../src/maintenance/engine";
import type { MigrationSnapshot } from "../src/maintenance/types";
import { board, canvasBytes, canvasDocument, card } from "./canvas-fixture";
import {
  encoded,
  SelectiveDevice,
  SelectiveRepository,
  selectiveLimits,
} from "./selective-fixture";

const previousCanvas = Effect.fn("fixture.previousCanvas")(function* (
  bytes: Uint8Array = canvasBytes(board()),
) {
  const document = yield* canvasDocument();
  document.edit(bytes, "binary");
  const id = crypto.randomUUID();
  const statePath = `.gitbin/vaults/personal/attachments/${id}.bin`;
  const content = objectReference(bytes);
  const file = {
    id,
    path: "Board.canvas",
    kind: "binary" as const,
    statePath,
    state: objectReference(document.bytes()),
    content,
    locations: [
      { id: crypto.randomUUID(), path: "Board.canvas", parents: [], contentHash: content.hash },
    ],
  };
  const metadata = { consolidationHash: null, appliedMigrations: migrationIds.slice(0, -1) };
  const source: MigrationSnapshot = {
    kind: "repository",
    files: new Map([
      [metadataPath, encoded(JSON.stringify(metadata))],
      [inventoryPath("personal"), encoded(JSON.stringify({ files: [file] }))],
      [statePath, document.bytes()],
      ["personal/Board.canvas", bytes],
    ]),
  };
  return { source, metadata, file };
});

function previousDevice({
  source,
  metadata,
  file,
}: Effect.Success<ReturnType<typeof previousCanvas>>) {
  const entry = {
    ...initialEntry(file),
    localPath: file.path,
    localContent: file.content,
    baselineState: file.state,
    available: true,
  };
  const journal = {
    metadata,
    vaultRoot: "personal",
    revision: "old",
    entries: [entry],
    intents: [],
    history: emptyHistory(),
  };
  const files = new Map<string, Uint8Array>([["journal.json", encoded(JSON.stringify(journal))]]);
  for (const bytes of [
    source.files.get(file.statePath),
    source.files.get("personal/Board.canvas"),
  ]) {
    if (!bytes) throw new Error("Missing fixture bytes");
    files.set("objects/" + objectReference(bytes).hash, bytes);
  }
  return { kind: "device" as const, files };
}

it.effect(
  "requires consolidation and preserves committed Canvas bytes and identity during migration",
  () =>
    Effect.gen(function* () {
      const { source, metadata, file } = yield* previousCanvas();
      expect(() => requireCurrentMetadata(metadata)).toThrow("migration required");
      const before = structuredClone(source);
      const result = yield* createMigrationEngine().prepare(source);
      expect(source).toEqual(before);
      const inventory = decodeInventory(
        result.repository.files.get(inventoryPath("personal")) ?? new Uint8Array(),
        "personal",
      );
      const migrated = inventory.files[0];
      expect(migrated?.id).toBe(file.id);
      expect(migrated?.kind).toBe("canvas");
      expect(result.repository.files.has(file.statePath)).toBe(false);
      const document = yield* canvasDocument(
        result.repository.files.get(migrated?.statePath ?? ""),
      );
      expect(document.textBytes()).toEqual(source.files.get("personal/Board.canvas"));
      expect(result.repository.files.get("personal/Board.canvas")).toEqual(document.textBytes());
      expect(result.migrations).toEqual(["Merge Canvas cards and connections independently"]);
      const again = yield* createMigrationEngine().prepare(result.repository);
      expect(again.migrations).toEqual([]);
    }),
);

it.effect("blocks invalid Canvas migration without changing source data", () =>
  Effect.gen(function* () {
    const { source } = yield* previousCanvas(encoded("{broken"));
    const before = structuredClone(source);
    expect((yield* Effect.exit(createMigrationEngine().prepare(source)))._tag).toBe("Failure");
    expect(source).toEqual(before);
  }),
);

it.effect(
  "retains uncaptured offline edits when an old device rejoins the consolidated repository",
  () =>
    Effect.gen(function* () {
      const previous = yield* previousCanvas();
      const device = new SelectiveDevice();
      const result = yield* createMigrationEngine().prepare(
        previous.source,
        previousDevice(previous),
      );
      device.journal = Schema.decodeUnknownSync(AvailabilityJournal)(
        JSON.parse(new TextDecoder().decode(result.device?.files.get("journal.json"))),
      );
      for (const [path, bytes] of result.device?.files ?? [])
        if (path.startsWith("objects/")) device.cache.set(path.slice(8), bytes);
      const changed = board();
      changed.nodes[0] = card("a", "Offline change");
      device.files.set("Board.canvas", canvasBytes(changed));
      const remote = new SelectiveRepository();
      for (const bytes of result.repository.files.values())
        remote.objects.set(objectReference(bytes).hash, bytes);
      remote.snapshot = {
        revision: "new",
        consolidationHash: result.consolidationHash,
        vaults: [{ root: "personal", name: "personal" }],
        inventory: decodeInventory(
          result.repository.files.get(inventoryPath("personal")) ?? new Uint8Array(),
          "personal",
        ),
      };
      const engine = yield* Effect.acquireRelease(
        Effect.sync(() =>
          createSelectiveEngine(
            { root: "personal", name: "personal" },
            device,
            remote,
            () => selectiveLimits,
          ),
        ),
        (engine) => Effect.sync(() => engine.close()),
      );
      yield* engine.open();
      yield* engine.sync();
      expect(device.files.get("Board.canvas")).toEqual(canvasBytes(changed));
      expect(remote.snapshot.inventory.files[0]?.kind).toBe("canvas");
      expect((yield* engine.sync()).pending).toBe(false);
    }),
);
