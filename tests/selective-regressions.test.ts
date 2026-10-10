import { expect, it, vi } from "@effect/vitest";
import { Effect } from "effect";
import { SyncError } from "../src/core/errors";
import { RawDocument } from "../src/core/raw-document";
import {
  decoded,
  encoded,
  SelectiveDevice,
  selectiveFixture,
  selectiveLimits,
} from "./selective-fixture";

it.effect("unlimited storage skips eviction but still enforces individual file admission", () =>
  Effect.gen(function* () {
    const { a, connect, repository } = yield* selectiveFixture();
    a.device.files.set("One.md", encoded("content"));
    a.device.files.set("Big.bin", new Uint8Array(1024));
    yield* a.engine.sync();
    const b = yield* connect(new SelectiveDevice(), {
      ...selectiveLimits,
      storageBytes: "unlimited",
      downloadBytes: 100,
    });
    b.device.usage = () => Effect.succeed(Number.MAX_SAFE_INTEGER);
    yield* b.engine.sync();
    yield* b.engine.download("One.md");
    expect(decoded(b.device.files.get("One.md"))).toBe("content");
    const count = repository.downloads.length;
    expect((yield* Effect.exit(b.engine.download("Big.bin")))._tag).toBe("Failure");
    expect(repository.downloads).toHaveLength(count);
    yield* b.engine.sync();
    expect(decoded(b.device.files.get("One.md"))).toBe("content");
  }),
);

it.effect("keeps unsent edits and identity across offline failure and restart", () =>
  Effect.gen(function* () {
    const { a, connect, repository } = yield* selectiveFixture();
    a.device.files.set("Note.md", encoded("base"));
    yield* a.engine.sync();
    a.device.files.set("Note.md", encoded("offline edit"));
    yield* a.engine.capture();
    const id = a.device.journal?.entries[0]?.file.id;
    const read = repository.read;
    repository.read = () => Effect.fail(new SyncError({ message: "Offline" }));
    expect((yield* Effect.exit(a.engine.sync()))._tag).toBe("Failure");
    expect(decoded(a.device.files.get("Note.md"))).toBe("offline edit");
    repository.read = read;
    a.engine.close();
    const b = yield* connect(a.device);
    yield* b.engine.sync();
    expect(b.device.journal?.entries[0]?.file.id).toBe(id);
    const fresh = yield* connect();
    yield* fresh.engine.sync();
    yield* fresh.engine.download("Note.md");
    expect(decoded(fresh.device.files.get("Note.md"))).toBe("offline edit");
  }),
);

for (const change of ["rename", "delete", "folder rename"]) {
  it.effect(`preserves concurrent edits against ${change}`, () =>
    Effect.gen(function* () {
      const { a, connect } = yield* selectiveFixture();
      const old = change === "folder rename" ? "Old/Note.md" : "Note.md";
      a.device.files.set(old, encoded("base"));
      yield* a.engine.sync();
      const b = yield* connect();
      yield* b.engine.sync();
      yield* b.engine.download(old);
      if (change !== "delete") {
        const target = change === "folder rename" ? "New/Note.md" : "Renamed.md";
        a.device.files.set(target, encoded("base"));
        a.device.files.delete(old);
        yield* a.engine.rename(
          change === "folder rename" ? "Old" : old,
          change === "folder rename" ? "New" : target,
        );
      } else a.device.files.delete(old);
      b.device.files.set(old, encoded("edited"));
      yield* b.engine.capture();
      yield* a.engine.sync();
      yield* b.engine.sync();
      yield* a.engine.sync();
      expect([...a.device.files.values()].map(decoded)).toEqual(["edited"]);
      expect(a.device.files).toEqual(b.device.files);
    }),
  );
}
for (const paths of [
  ["Note.md", "note.md"],
  ["Folder", "Folder/Note.md"],
] as const) {
  it.effect(`retains both files in a path collision: ${paths.join(" / ")}`, () =>
    Effect.gen(function* () {
      const { a, connect } = yield* selectiveFixture();
      const b = yield* connect(new SelectiveDevice(), { ...selectiveLimits, mode: "all" });
      a.limits.mode = "all";
      a.device.files.set(paths[0], encoded("first"));
      b.device.files.set(paths[1], encoded("second"));
      yield* a.engine.capture();
      yield* b.engine.capture();
      yield* a.engine.sync();
      yield* b.engine.sync();
      yield* a.engine.sync();
      expect([...a.device.files.values()].map(decoded).sort()).toEqual(["first", "second"]);
      expect(a.device.files).toEqual(b.device.files);
    }),
  );
}

it.effect("rejects damaged downloaded bytes without replacing the placeholder", () =>
  Effect.gen(function* () {
    const { a, connect, repository } = yield* selectiveFixture();
    a.device.files.set("Note.md", encoded("original"));
    yield* a.engine.sync();
    const b = yield* connect();
    yield* b.engine.sync();
    const hash = repository.snapshot.inventory.files[0]?.content.hash;
    if (!hash) throw new Error("Missing fixture content");
    repository.objects.set(hash, encoded("damaged"));
    expect((yield* Effect.exit(b.engine.download("Note.md")))._tag).toBe("Failure");
    expect(b.device.files.get("Note.md")).toEqual(new Uint8Array());
    expect(b.engine.status("Note.md")).toContain("Cannot fetch fixture object");
  }),
);

it.effect("preserves an edit arriving during materialization and recovers after restart", () =>
  Effect.gen(function* () {
    const { a, connect } = yield* selectiveFixture();
    a.device.files.set("Note.md", encoded("base\n"));
    yield* a.engine.sync();
    const b = yield* connect();
    yield* b.engine.sync();
    yield* b.engine.download("Note.md");
    a.device.files.set("Note.md", encoded("base\nremote edit\n"));
    yield* a.engine.sync();
    const write = b.device.write;
    let race = true;
    b.device.write = (...args) =>
      Effect.gen(function* () {
        if (race) {
          race = false;
          b.device.files.set("Note.md", encoded("typing during sync\nbase\n"));
        }
        return yield* write(...args);
      });
    expect((yield* b.engine.sync()).pending).toBe(true);
    expect(decoded(b.device.files.get("Note.md"))).toBe("typing during sync\nbase\n");
    b.engine.close();
    const restarted = yield* connect(b.device);
    yield* restarted.engine.sync();
    expect([...restarted.device.files.values()].map(decoded).join(" ")).toContain(
      "typing during sync",
    );
  }),
);

it.effect("closes temporary CRDT documents even when capturing an edit fails", () =>
  Effect.gen(function* () {
    const { a } = yield* selectiveFixture();
    a.device.files.set("Note.md", encoded("base"));
    yield* a.engine.sync();
    const close = vi.spyOn(RawDocument.prototype, "close");
    const edit = vi.spyOn(RawDocument.prototype, "edit").mockImplementation(() => {
      throw new Error("Diff timed out");
    });
    try {
      a.device.files.set("Note.md", encoded("unsaved to remote"));
      yield* a.engine.capture();
      expect(close).toHaveBeenCalledTimes(2);
      expect(decoded(a.device.files.get("Note.md"))).toBe("unsaved to remote");
      expect(a.device.journal?.entries[0]?.issue).toContain("Cannot capture saved edits");
    } finally {
      edit.mockRestore();
      close.mockRestore();
    }
  }),
);
