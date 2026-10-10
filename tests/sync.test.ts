import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { vi } from "vitest";
import { objectReference } from "../src/core/inventory";
import { checkRemote } from "../src/git/remote";
import { commitAuthor } from "../src/platform/device";
import { encoded, SelectiveDevice, selectiveLimits } from "./selective-fixture";
import { realSelectiveFixture } from "./selective-git-fixture";

vi.mock("obsidian", () => ({ Platform: {} }));
const vault = { root: "personal", name: "personal" };
it.effect(
  "stores binary bytes once with small reference state and restores them on a fresh device",
  () =>
    Effect.gen(function* () {
      const test = yield* realSelectiveFixture();
      const limits = { ...selectiveLimits, downloadBytes: 2 * 1024 * 1024, mode: "all" as const };
      const a = yield* test.connect(new SelectiveDevice(), "personal", limits);
      const bytes = new Uint8Array(1024 * 1024).fill(42);
      a.device.files.set("Large.bin", bytes);
      yield* a.engine.sync();
      const snapshot = yield* a.remote.read(vault);
      expect(snapshot.inventory.files[0]?.state.bytes).toBeLessThan(2000);
      expect(JSON.stringify(a.device.journal).length).toBeLessThan(6000);
      expect(yield* test.git(["rev-parse", "main:personal/Large.bin"])).toBe(
        objectReference(bytes).hash,
      );
      expect(yield* test.git(["ls-tree", "-r", "--name-only", "main"])).not.toContain("/retained/");
      const b = yield* test.connect(new SelectiveDevice(), "personal", limits);
      yield* b.engine.sync();
      expect(b.device.files.get("Large.bin")).toEqual(bytes);
    }),
);

it.effect("retries a failed initial upload after restart without losing binary bytes", () =>
  Effect.gen(function* () {
    const test = yield* realSelectiveFixture();
    const fetch = test.connection.network.fetch;
    let fail = true;
    test.connection.network.fetch = (input, init) => {
      if (
        fail &&
        (input instanceof Request ? input.url : String(input)).endsWith("/git-receive-pack")
      )
        return Promise.reject(new Error("Upload interrupted"));
      return fetch(input, init);
    };
    const a = yield* test.connect();
    const bytes = new Uint8Array([0, 1, 255]);
    a.device.files.set("File.bin", bytes);
    expect((yield* Effect.exit(a.engine.sync()))._tag).toBe("Failure");
    expect(a.device.cache.get(objectReference(bytes).hash)).toEqual(bytes);
    a.engine.close();
    fail = false;
    const reopened = yield* test.connect(a.device);
    yield* reopened.engine.sync();
    const b = yield* test.connect();
    yield* b.engine.sync();
    expect(b.device.files.get("File.bin")).toEqual(bytes);
    expect(yield* test.git(["rev-list", "--count", "main"])).toBe("1");
  }),
);

it.effect("leaves empty vaults unregistered and retains the identity of a deleted last file", () =>
  Effect.gen(function* () {
    const test = yield* realSelectiveFixture();
    const a = yield* test.connect();
    expect((yield* a.engine.sync()).revision).toBeNull();
    a.device.files.set("Last.bin", new Uint8Array([0, 8]));
    yield* a.engine.sync();
    const empty = yield* test.connect(new SelectiveDevice(), "work");
    yield* empty.engine.sync();
    expect((yield* a.remote.read(vault)).vaults.map((v) => v.root)).toEqual(["personal"]);
    a.device.files.delete("Last.bin");
    yield* a.engine.sync();
    const b = yield* test.connect();
    yield* b.engine.sync();
    expect(b.device.files.size).toBe(0);
    expect((yield* b.remote.read(vault)).inventory.files[0]?.path).toBeNull();
    b.engine.close();
    const reopened = yield* test.connect(b.device);
    yield* reopened.engine.sync();
    expect(reopened.device.files.size).toBe(0);
  }),
);

for (const email of ["", "alice@example.com"]) {
  it.effect(`preserves the configured commit author: ${email || "device fallback"}`, () =>
    Effect.gen(function* () {
      const test = yield* realSelectiveFixture();
      test.connection.identity.author = commitAuthor(
        { username: "alice", commitEmail: email },
        "Laptop",
      );
      const a = yield* test.connect();
      a.device.files.set("Note.md", encoded("Authored"));
      yield* a.engine.sync();
      expect(yield* test.git(["log", "-1", "--format=%an%n%ae%n%cn%n%ce"])).toBe(
        `alice\n${email || "alice@Laptop"}\nGitbin\ngitbin@test`,
      );
    }),
  );
}

it.effect("returns the final synced inventory and preserves other vaults", () =>
  Effect.gen(function* () {
    const test = yield* realSelectiveFixture();
    const a = yield* test.connect();
    a.device.files.set("One.md", encoded("Original"));
    const first = yield* a.engine.sync();
    expect(first.snapshot?.revision).toBe(first.revision);
    const b = yield* test.connect(new SelectiveDevice(), "work");
    b.device.files.set("Two.md", encoded("Work"));
    yield* b.engine.sync();
    const final = yield* a.engine.sync();
    expect(final.snapshot?.revision).toBe(final.revision);
    expect(final.snapshot?.vaults.map((entry) => entry.root).sort()).toEqual(["personal", "work"]);
    expect(final.snapshot?.inventory.files.map((entry) => entry.path)).toEqual(["One.md"]);
    expect(yield* test.git(["show", "main:work/Two.md"])).toBe("Work");
  }),
);

it.effect("retries competing publications and converges without losing either client", () =>
  Effect.gen(function* () {
    const test = yield* realSelectiveFixture();
    const a = yield* test.connect();
    a.device.files.set("Seed.md", encoded("seed"));
    yield* a.engine.sync();
    const b = yield* test.connect();
    yield* b.engine.sync();
    const publish = a.remote.publish;
    let race = true;
    a.remote.publish = (...args) =>
      Effect.gen(function* () {
        if (race) {
          race = false;
          b.device.files.set("Other.md", encoded("competitor"));
          yield* b.engine.sync();
        }
        return yield* publish(...args);
      });
    a.device.files.set("Mine.md", encoded("mine"));
    yield* a.engine.sync();
    yield* b.engine.sync();
    expect([...a.device.files.keys()].sort()).toEqual(["Mine.md", "Other.md", "Seed.md"]);
    expect(b.device.files).toEqual(a.device.files);
  }),
);

it.effect("consolidation drops deleted content and compacts text state", () =>
  Effect.gen(function* () {
    const test = yield* realSelectiveFixture();
    const a = yield* test.connect();
    a.device.files.set("Removed.bin", new Uint8Array([0, 1, 255]));
    a.device.files.set("Keep.md", encoded("first"));
    yield* a.engine.sync();
    for (let i = 0; i < 8; i++) {
      a.device.files.set("Keep.md", encoded("revision " + i));
      yield* a.engine.capture();
    }
    a.device.files.delete("Removed.bin");
    yield* a.engine.sync();
    const before = yield* a.remote.read(vault);
    expect(yield* test.git(["ls-tree", "-r", "--name-only", "main"])).toContain("/retained/");
    const preview = yield* test.maintenance.preview();
    yield* test.maintenance.apply(preview.sourceRevision, preview.revision);
    const after = yield* a.remote.read(vault);
    expect(after.inventory.files).toHaveLength(1);
    expect(after.inventory.files[0]?.state.bytes).toBeLessThan(
      before.inventory.files.reduce((n, f) => n + f.state.bytes, 0),
    );
    expect(yield* test.git(["ls-tree", "-r", "--name-only", "main"])).not.toContain("/retained/");
    expect(yield* test.git(["show", "main:personal/Keep.md"])).toBe("revision 7");
    expect(yield* test.git(["rev-list", "--count", "main"])).toBe("1");
  }),
);

it("rejects credentials and command-like remotes", () => {
  for (const url of ["https://github.com/user/repo.git", "https://gitlab.com/user/repo.git"])
    expect(() => checkRemote(url)).not.toThrow();
  for (const url of [
    "https://token@github.com/user/repo.git",
    "-oProxyCommand=bad",
    "ext::bad",
    "git@github.com:user/repo.git",
    "ssh://git@gitlab.com/user/repo.git",
    "https://github.com/a\nb",
  ])
    expect(() => checkRemote(url)).toThrow();
});
