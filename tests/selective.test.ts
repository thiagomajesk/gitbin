import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { objectReference } from "../src/core/inventory";
import { RawDocument } from "../src/core/raw-document";
import {
  decoded,
  encoded,
  SelectiveDevice,
  selectiveFixture,
  selectiveLimits,
} from "./selective-fixture";

it.effect("keeps large remote files visible and renames them without downloading content", () =>
  Effect.gen(function* () {
    const { a, repository, connect } = yield* selectiveFixture();
    a.device.files.set("Note.md", encoded("hello"));
    a.device.files.set("Large.bin", new Uint8Array(4096).fill(42));
    yield* a.engine.sync();
    const b = yield* connect(new SelectiveDevice(), { ...selectiveLimits, downloadBytes: 1024 });
    yield* b.engine.sync();
    expect([...b.device.files.values()].every((bytes) => bytes.length === 0)).toBe(true);
    expect(repository.downloads).toEqual([]);
    b.device.files.set("Renamed.bin", new Uint8Array());
    b.device.files.delete("Large.bin");
    yield* b.engine.rename("Large.bin", "Renamed.bin");
    yield* b.engine.sync();
    expect(repository.snapshot.inventory.files.some((file) => file.path === "Renamed.bin")).toBe(
      true,
    );
    expect((yield* Effect.exit(b.engine.download("Renamed.bin")))._tag).toBe("Failure");
    expect(repository.downloads).toEqual([]);
    yield* b.engine.download("Note.md");
    expect(decoded(b.device.files.get("Note.md"))).toBe("hello");
  }),
);

it.effect("merges concurrent text edits into already downloaded closed files", () =>
  Effect.gen(function* () {
    const { a, connect } = yield* selectiveFixture();
    a.device.files.set("Note.md", encoded("Base\n"));
    yield* a.engine.sync();
    const b = yield* connect();
    yield* b.engine.sync();
    yield* b.engine.download("Note.md");
    a.device.files.set("Note.md", encoded("A\nBase\n"));
    yield* a.engine.capture();
    b.device.files.set("Note.md", encoded("Base\nB\n"));
    yield* b.engine.capture();
    yield* a.engine.sync();
    yield* b.engine.sync();
    yield* a.engine.sync();
    expect(decoded(a.device.files.get("Note.md"))).toBe("A\nBase\nB\n");
    expect(b.device.files.get("Note.md")).toEqual(a.device.files.get("Note.md"));
  }),
);

it.effect("preserves unexpected edits to an unloaded placeholder as a separate file", () =>
  Effect.gen(function* () {
    const { a, connect } = yield* selectiveFixture();
    a.device.files.set("Note.md", encoded("Remote"));
    yield* a.engine.sync();
    const b = yield* connect();
    yield* b.engine.sync();
    b.device.files.set("Note.md", encoded("Unexpected local edit"));
    yield* b.engine.sync();
    const recovered = [...b.device.files].find(([path]) => path.startsWith("Recovered "));
    expect(decoded(recovered?.[1])).toBe("Unexpected local edit");
    yield* b.engine.download("Note.md");
    expect(decoded(b.device.files.get("Note.md"))).toBe("Remote");
  }),
);

it.effect("recovers an interrupted hydration without overwriting a subsequent edit", () =>
  Effect.gen(function* () {
    const { a, connect } = yield* selectiveFixture();
    a.device.files.set("Note.md", encoded("Remote"));
    yield* a.engine.sync();
    const b = yield* connect();
    yield* b.engine.sync();
    b.device.failAfterWrite = true;
    expect((yield* Effect.exit(b.engine.download("Note.md")))._tag).toBe("Failure");
    const restarted = yield* connect(b.device);
    yield* restarted.engine.capture();
    expect(restarted.engine.status("Note.md")).toBeNull();
    expect(b.device.journal?.intents).toEqual([]);
    b.device.files.set("Note.md", encoded("Edited after recovery"));
    yield* restarted.engine.sync();
    expect(decoded(b.device.files.get("Note.md"))).toBe("Edited after recovery");
  }),
);

it.effect("publishes local files above the download limit alongside smaller files", () =>
  Effect.gen(function* () {
    const { a, repository } = yield* selectiveFixture();
    a.device.files.set("Large.md", encoded("x".repeat(selectiveLimits.downloadBytes + 1)));
    a.device.files.set("Small.md", encoded("Saved"));
    const result = yield* a.engine.sync();
    expect(result.pending).toBe(false);
    expect(repository.snapshot.inventory.files.map((file) => file.path).sort()).toEqual([
      "Large.md",
      "Small.md",
    ]);
    expect(a.device.files.get("Large.md")?.length).toBe(selectiveLimits.downloadBytes + 1);
  }),
);

it.effect("records reference-only history and downloads only the selected comparison", () =>
  Effect.gen(function* () {
    const { a, repository, connect } = yield* selectiveFixture();
    a.device.files.set("Note.md", encoded("First"));
    yield* a.engine.sync();
    const b = yield* connect();
    yield* b.engine.sync();
    expect(repository.downloads).toEqual([]);
    const change = b.engine.history()[0]?.changes[0];
    if (!change) throw new Error("Missing history.");
    expect(change.result.text).toBeNull();
    const loaded = yield* b.engine.historyChange(change);
    expect(loaded.result.text).toBe("First");
    expect(b.device.files.get("Note.md")?.length).toBe(0);
  }),
);

it.effect("evicts a clean closed download but protects an open file", () =>
  Effect.gen(function* () {
    const { a, connect } = yield* selectiveFixture();
    a.device.files.set("One.bin", new Uint8Array(8000).fill(1));
    a.device.files.set("Two.bin", new Uint8Array(8000).fill(2));
    yield* a.engine.sync();
    const b = yield* connect(new SelectiveDevice(), { ...selectiveLimits, storageBytes: 100000 });
    yield* b.engine.sync();
    yield* b.engine.download("One.bin");
    b.device.opened.add("One.bin");
    expect((yield* Effect.exit(b.engine.download("Two.bin")))._tag).toBe("Failure");
    expect(b.device.files.get("One.bin")?.length).toBe(8000);
    b.device.opened.delete("One.bin");
    yield* b.engine.download("Two.bin");
    expect(b.device.files.get("One.bin")?.length).toBe(0);
    expect(b.device.files.get("Two.bin")?.length).toBe(8000);
    expect(yield* b.device.usage()).toBeLessThanOrEqual(100000);
  }),
);

it.effect("keeps both binary edits when devices replace the same attachment", () =>
  Effect.gen(function* () {
    const { a, connect } = yield* selectiveFixture();
    a.device.files.set("File.bin", new Uint8Array([1]));
    yield* a.engine.sync();
    const b = yield* connect();
    yield* b.engine.sync();
    yield* b.engine.download("File.bin");
    a.device.files.set("File.bin", new Uint8Array([2]));
    yield* a.engine.capture();
    b.device.files.set("File.bin", new Uint8Array([3]));
    yield* b.engine.capture();
    yield* a.engine.sync();
    yield* b.engine.sync();
    expect(b.device.files.get("File.bin")).toEqual(new Uint8Array([2]));
    expect(
      [...b.device.files].some(([path, bytes]) => path.startsWith("Recovered ") && bytes[0] === 3),
    ).toBe(true);
  }),
);

it.effect(
  "rebases pending edits after consolidation instead of merging unrelated CRDT generations",
  () =>
    Effect.gen(function* () {
      const { a, repository } = yield* selectiveFixture();
      a.device.files.set("Note.md", encoded("Base"));
      yield* a.engine.sync();
      a.device.files.set("Note.md", encoded("Local Base"));
      yield* a.engine.capture();
      const previous = repository.snapshot.inventory.files[0];
      if (!previous) throw new Error("Missing file.");
      const document = new RawDocument();
      document.edit(encoded("Base"), "text");
      const bytes = document.bytes();
      document.close();
      repository.objects.set(objectReference(bytes).hash, bytes);
      repository.snapshot = {
        ...repository.snapshot,
        revision: "rewritten",
        consolidationHash: "a".repeat(64),
        inventory: {
          files: [
            {
              ...previous,
              state: objectReference(bytes),
              locations: [
                {
                  id: crypto.randomUUID(),
                  path: "Note.md",
                  parents: [],
                  contentHash: previous.content.hash,
                },
              ],
            },
          ],
        },
      };
      yield* a.engine.sync();
      expect(decoded(a.device.files.get("Note.md"))).toBe("Local Base");
      expect(a.engine.details().entries.every((entry) => !entry.dirty && !entry.issue)).toBe(true);
    }),
);
