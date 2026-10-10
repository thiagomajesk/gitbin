import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { vi } from "vitest";
import { encoded, selectiveFixture } from "./selective-fixture";

it.effect(
  "captures changed paths without reading unrelated edits and ignores unchanged notifications",
  () =>
    Effect.gen(function* () {
      const { a } = yield* selectiveFixture();
      a.device.files.set("Changed.md", encoded("before"));
      a.device.files.set("Other.md", encoded("other"));
      yield* a.engine.sync();
      const reads = vi.spyOn(a.device, "read");
      expect(yield* a.engine.capture(new Set(["Changed.md"]))).toBe(false);
      expect(reads.mock.calls.map(([path]) => path)).toEqual(["Changed.md"]);
      a.device.files.set("Changed.md", encoded("after"));
      a.device.files.set("Other.md", encoded("unrelated pending edit"));
      reads.mockClear();
      expect(yield* a.engine.capture(new Set(["Changed.md"]))).toBe(true);
      expect(reads.mock.calls.map(([path]) => path)).toEqual(["Changed.md"]);
      expect(
        a.engine.details().entries.find((entry) => entry.localPath === "Other.md")?.dirty,
      ).toBe(false);
      yield* a.engine.capture();
      expect(
        a.engine.details().entries.find((entry) => entry.localPath === "Other.md")?.dirty,
      ).toBe(true);
    }),
);

it.effect("downloads without rereading unrelated files and captures their edits on sync", () =>
  Effect.gen(function* () {
    const { a, connect } = yield* selectiveFixture();
    for (let i = 0; i < 100; i++) a.device.files.set(`${i}.md`, encoded(`note ${i}`));
    yield* a.engine.sync();
    const reads = vi.spyOn(a.device, "read");
    const saves = vi.spyOn(a.device, "save");
    yield* a.engine.capture();
    expect(reads).toHaveBeenCalledTimes(100);
    expect(saves).toHaveBeenCalledTimes(1);
    const b = yield* connect();
    b.device.files.set("Remote.md", encoded("remote content"));
    yield* b.engine.sync();
    yield* a.engine.sync();
    reads.mockClear();
    const scans = vi.spyOn(a.device, "objects");
    a.device.files.set("0.md", encoded("pending edit"));
    yield* a.engine.download("Remote.md");
    expect(reads).not.toHaveBeenCalled();
    expect(scans).toHaveBeenCalledTimes(1);
    expect(a.device.files.get("0.md")).toEqual(encoded("pending edit"));
    yield* a.engine.sync();
    yield* b.engine.sync();
    yield* b.engine.download("0.md");
    expect(b.device.files.get("0.md")).toEqual(encoded("pending edit"));
  }),
);
