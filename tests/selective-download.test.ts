import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { SelectiveDevice, selectiveFixture, selectiveLimits } from "./selective-fixture";

it.effect(
  "checks the complete download before fetching state and retries after increasing space",
  () =>
    Effect.gen(function* () {
      const { a, connect, repository } = yield* selectiveFixture();
      a.device.files.set("File.bin", new Uint8Array(8000).fill(1));
      yield* a.engine.sync();
      const b = yield* connect(new SelectiveDevice(), { ...selectiveLimits, storageBytes: 80000 });
      yield* b.engine.sync();
      const count = repository.downloads.length;
      expect((yield* Effect.exit(b.engine.download("File.bin")))._tag).toBe("Failure");
      expect(repository.downloads).toHaveLength(count);
      expect(b.engine.status("File.bin")).toContain("Increase the local storage limit");
      expect(b.device.files.get("File.bin")?.length).toBe(0);
      b.limits.storageBytes = 100000;
      yield* b.engine.download("File.bin");
      expect(b.device.files.get("File.bin")?.length).toBe(8000);
      expect(b.engine.status("File.bin")).toBeNull();
    }),
);

it.effect("does not evict existing downloads when the new file cannot fit even by itself", () =>
  Effect.gen(function* () {
    const { a, connect, repository } = yield* selectiveFixture();
    a.device.files.set("Small.bin", new Uint8Array(1000).fill(1));
    a.device.files.set("Large.bin", new Uint8Array(20000).fill(2));
    yield* a.engine.sync();
    const b = yield* connect(new SelectiveDevice(), { ...selectiveLimits, storageBytes: 100000 });
    yield* b.engine.sync();
    yield* b.engine.download("Small.bin");
    const count = repository.downloads.length;
    expect((yield* Effect.exit(b.engine.download("Large.bin")))._tag).toBe("Failure");
    expect(repository.downloads).toHaveLength(count);
    expect(b.device.files.get("Small.bin")?.length).toBe(1000);
    expect(b.device.files.get("Large.bin")?.length).toBe(0);
  }),
);

it.effect("reuses cached objects without requiring download working space again", () =>
  Effect.gen(function* () {
    const { a, connect, repository } = yield* selectiveFixture();
    a.device.files.set("File.bin", new Uint8Array(8000).fill(1));
    yield* a.engine.sync();
    const b = yield* connect(new SelectiveDevice(), { ...selectiveLimits, storageBytes: 30000 });
    yield* b.engine.sync();
    for (const [hash, bytes] of a.device.cache) b.device.cache.set(hash, bytes);
    b.limits.downloadBytes = 100;
    const count = repository.downloads.length;
    yield* b.engine.download("File.bin");
    expect(repository.downloads).toHaveLength(count);
    expect(b.device.files.get("File.bin")?.length).toBe(8000);
    expect(yield* b.device.usage()).toBeLessThanOrEqual(30000);
  }),
);

it.effect("downloads image bytes without imposing pixel or preview-format restrictions", () =>
  Effect.gen(function* () {
    const { a, connect } = yield* selectiveFixture();
    const bytes = new Uint8Array(45);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
    const header = new DataView(bytes.buffer);
    header.setUint32(16, 10000);
    header.setUint32(20, 10000);
    a.device.files.set("Large dimensions.png", bytes);
    yield* a.engine.sync();
    const b = yield* connect(new SelectiveDevice());
    yield* b.engine.sync();
    yield* b.engine.download("Large dimensions.png");
    expect(b.device.files.get("Large dimensions.png")).toEqual(bytes);
    expect(b.engine.status("Large dimensions.png")).toBeNull();
  }),
);

it.effect(
  "uploads local attachments above the download limit and applies the limit on receipt",
  () =>
    Effect.gen(function* () {
      const { a, connect } = yield* selectiveFixture();
      a.limits.downloadBytes = 100;
      const bytes = new Uint8Array(200).fill(42);
      a.device.files.set("Custom.unknown", bytes);
      yield* a.engine.sync();
      const b = yield* connect();
      b.limits.downloadBytes = 100;
      yield* b.engine.sync();
      expect((yield* Effect.exit(b.engine.download("Custom.unknown")))._tag).toBe("Failure");
      b.limits.downloadBytes = 200;
      yield* b.engine.download("Custom.unknown");
      expect(b.device.files.get("Custom.unknown")).toEqual(bytes);
    }),
);

it.effect("preserves and uploads local note edits above the configured download size", () =>
  Effect.gen(function* () {
    const { a, connect } = yield* selectiveFixture();
    a.device.files.set("Note.md", new TextEncoder().encode("Small"));
    yield* a.engine.sync();
    a.limits.downloadBytes = 10;
    const bytes = new TextEncoder().encode("Larger local edits".repeat(20));
    a.device.files.set("Note.md", bytes);
    yield* a.engine.sync();
    const b = yield* connect();
    yield* b.engine.sync();
    yield* b.engine.download("Note.md");
    expect(b.device.files.get("Note.md")).toEqual(bytes);
  }),
);

it.effect("downloads unlimited files through the transport using finite object bounds", () =>
  Effect.gen(function* () {
    const { a, connect } = yield* selectiveFixture();
    a.device.files.set("File.custom", new Uint8Array(100).fill(42));
    yield* a.engine.sync();
    const b = yield* connect();
    b.limits.downloadBytes = Infinity;
    yield* b.engine.sync();
    yield* b.engine.download("File.custom");
    expect(b.device.files.get("File.custom")?.length).toBe(100);
  }),
);
