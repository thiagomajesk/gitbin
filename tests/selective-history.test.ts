import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { vi } from "vitest";
import { encoded, selectiveFixture } from "./selective-fixture";

it.effect("loads cached comparisons offline and never fetches missing versions offline", () =>
  Effect.gen(function* () {
    const { a, connect, repository } = yield* selectiveFixture();
    a.device.files.set("Note.md", encoded("Preview text"));
    yield* a.engine.sync();
    const b = yield* connect();
    yield* b.engine.sync();
    const change = b.engine.history()[0]?.changes[0];
    if (!change) throw new Error("Missing comparison");
    const scans = vi.spyOn(b.device, "objects");
    expect(yield* b.engine.historyCached(change)).toBe(false);
    expect(scans).not.toHaveBeenCalled();
    const before = repository.downloads.length;
    expect((yield* Effect.exit(b.engine.historyChange(change, () => false)))._tag).toBe("Failure");
    expect(repository.downloads).toHaveLength(before);
    yield* b.engine.download("Note.md");
    expect(yield* b.engine.historyCached(change)).toBe(true);
    const cached = repository.downloads.length;
    const loaded = yield* b.engine.historyChange(change, () => false);
    expect(loaded.result.text).toBe("Preview text");
    expect(repository.downloads).toHaveLength(cached);
  }),
);

it.effect("uses the configured size limit for comparisons without a hidden line limit", () =>
  Effect.gen(function* () {
    const { a, connect } = yield* selectiveFixture();
    a.limits.downloadBytes = 100000;
    const text = "A line of history content\n".repeat(3000);
    a.device.files.set("Note.md", encoded(text));
    yield* a.engine.sync();
    const b = yield* connect();
    yield* b.engine.sync();
    const change = b.engine.history()[0]?.changes[0];
    if (!change) throw new Error("Missing comparison");
    b.limits.downloadBytes = 100;
    expect((yield* Effect.exit(b.engine.historyChange(change)))._tag).toBe("Failure");
    b.limits.downloadBytes = 100000;
    const loaded = yield* b.engine.historyChange(change);
    expect(loaded.result.text).toBe(text);
    b.limits.downloadBytes = 100;
    expect((yield* b.engine.historyChange(change, () => false)).result.text).toBe(text);
  }),
);
