import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { io } from "../src/core/errors";
import { contentCatalog } from "../src/git/catalog";
import { gitSession } from "../src/git/session";
import { encoded, SelectiveDevice, selectiveLimits } from "./selective-fixture";
import { realSelectiveFixture } from "./selective-git-fixture";

const vault = { root: "personal", name: "Personal" };
it.effect(
  "rejects insufficient working space without a Git request and downloads after retry",
  () =>
    Effect.gen(function* () {
      const client = yield* fixture();
      client.limits.storageBytes = 65536;
      const before = client.requests();
      expect((yield* Effect.exit(client.reader.engine.download("Note.md")))._tag).toBe("Failure");
      expect(client.requests()).toBe(before);
      expect(client.reader.engine.status("Note.md")).toContain("Increase the local storage limit");
      client.limits.storageBytes = selectiveLimits.storageBytes;
      yield* client.reader.engine.download("Note.md");
      expect(client.reader.engine.status("Note.md")).toBeNull();
      expect(new TextDecoder().decode(client.reader.device.files.get("Note.md"))).toBe(
        "Small note\n",
      );
    }),
);
const fixture = (duplicate = false) =>
  Effect.gen(function* () {
    const test = yield* realSelectiveFixture();
    let requests = 0;
    const fetch = test.connection.network.fetch;
    test.connection.network.fetch = (input, init) => {
      requests++;
      return fetch(input, init);
    };
    const writer = yield* test.connect();
    writer.device.files.set("Note.md", encoded("Small note\n"));
    const attachment = new Uint8Array(1024);
    writer.device.files.set("Large.bin", attachment);
    if (duplicate) writer.device.files.set("Copy.bin", attachment);
    yield* writer.engine.sync();
    const session = gitSession(test.connection);
    const catalog = contentCatalog(session);
    const limits = { ...selectiveLimits, downloadBytes: 100 };
    const reader = yield* test.connect(new SelectiveDevice(), vault.root, limits);
    yield* reader.engine.sync();
    return {
      session,
      catalog,
      engine: writer.engine,
      local: writer.device,
      reader,
      limits,
      requests: () => requests,
    };
  });
it.effect(
  "discovers without fetching state/content, refuses oversize before transfer, and hydrates only the selected file",
  () =>
    Effect.gen(function* () {
      const client = yield* fixture();
      const snapshot = yield* client.catalog.read(vault);
      const repo = yield* io("Open cache", client.session.repo);
      expect(snapshot.inventory.files).toHaveLength(2);
      for (const file of snapshot.inventory.files) {
        expect(yield* io("Inspect cache", () => repo.objectStore.exists(file.content.hash))).toBe(
          false,
        );

        expect(yield* io("Inspect cache", () => repo.objectStore.exists(file.state.hash))).toBe(
          false,
        );
      }
      const huge = snapshot.inventory.files.find((file) => file.path === "Large.bin");
      const note = snapshot.inventory.files.find((file) => file.path === "Note.md");
      if (!huge || !note) throw new Error("Missing fixture files");
      const before = client.requests();
      expect((yield* Effect.exit(client.reader.engine.download("Large.bin")))._tag).toBe("Failure");
      expect(client.requests()).toBe(before);
      yield* client.reader.engine.download("Note.md");
      expect(new TextDecoder().decode(client.reader.device.files.get("Note.md"))).toBe(
        "Small note\n",
      );
      expect(yield* io("Inspect cache", () => repo.objectStore.exists(huge.content.hash))).toBe(
        false,
      );
      expect(yield* io("Inspect cache", () => repo.objectStore.exists(huge.state.hash))).toBe(
        false,
      );
    }),
);

it.effect("downloads state for an admitted file and rejects incorrect declared sizes", () =>
  Effect.gen(function* () {
    const client = yield* fixture();
    const snapshot = yield* client.catalog.read(vault);
    const note = snapshot.inventory.files.find((file) => file.path === "Note.md");
    if (!note) throw new Error("Missing fixture note");
    client.limits.downloadBytes = note.content.bytes;
    expect(note.state.bytes).toBeGreaterThan(client.limits.downloadBytes);
    yield* client.reader.engine.download("Note.md");
    expect(client.reader.device.files.get("Note.md")).toEqual(encoded("Small note\n"));
    const incorrect = { ...note.content, bytes: 1 };
    expect((yield* Effect.exit(client.catalog.object(incorrect, 100)))._tag).toBe("Failure");
  }),
);

it.effect(
  "keeps a deleted binary reference when identical bytes remain in another visible file",
  () =>
    Effect.gen(function* () {
      const client = yield* fixture(true);
      client.local.files.delete("Large.bin");
      yield* client.engine.sync();
      const snapshot = yield* client.catalog.read(vault);
      expect(snapshot.inventory.files.filter((file) => file.path === null)).toHaveLength(1);
      expect(snapshot.inventory.files.find((file) => file.path === "Copy.bin")?.content.bytes).toBe(
        1024,
      );
    }),
);
it.effect(
  "preserves local files and gives a recovery action for an inconsistent remote inventory",
  () =>
    Effect.gen(function* () {
      const fixture = yield* realSelectiveFixture();
      const client = yield* fixture.connect();
      client.device.files.set("Note.md", encoded("preserve me"));
      yield* client.engine.sync();
      yield* fixture.git(["read-tree", "main"]);
      yield* fixture.git(["--work-tree=.", "update-index", "--force-remove", "personal/Note.md"]);
      const tree = yield* fixture.git(["write-tree"]);
      const revision = yield* fixture.git([
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@localhost",
        "commit-tree",
        tree,
        "-p",
        "main",
        "-m",
        "External deletion",
      ]);
      yield* fixture.git(["update-ref", "refs/heads/main", revision]);
      const message = yield* client.engine.sync().pipe(
        Effect.match({
          onFailure: (error) => error.message,
          onSuccess: () => "unexpected success",
        }),
      );
      expect(message).toBe(
        "Repository metadata is inconsistent. Reinitialize the repository in Settings, then sync again.",
      );
      expect(client.device.files.get("Note.md")).toEqual(encoded("preserve me"));
    }),
);
