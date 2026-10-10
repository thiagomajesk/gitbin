import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { encoded, selectiveFixture } from "./selective-fixture";

it.effect("blocks oversized remote edits before downloading their text state", () =>
  Effect.gen(function* () {
    const { a, connect, repository } = yield* selectiveFixture();
    a.device.files.set("Note.md", encoded("base"));
    yield* a.engine.sync();
    const b = yield* connect();
    yield* b.engine.sync();
    yield* b.engine.download("Note.md");
    a.device.files.set("Note.md", encoded("base local"));
    b.device.files.set("Note.md", encoded("base " + "remote ".repeat(1000)));
    yield* b.engine.sync();
    a.limits.downloadBytes = 100;
    repository.downloads.length = 0;
    yield* a.engine.sync();
    expect(repository.downloads).toHaveLength(0);
    expect(a.device.files.get("Note.md")).toEqual(encoded("base local"));
    expect(a.engine.details().entries[0]?.issue).toContain("max download size");
    a.limits.downloadBytes = 20000;
    yield* a.engine.sync();
    const result = new TextDecoder().decode(a.device.files.get("Note.md"));
    expect(result).toContain("local");
    expect(result).toContain("remote");
  }),
);
