import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { encoded, SelectiveDevice, selectiveFixture } from "./selective-fixture";

it.effect("restores more than 10,000 inventory entries without a byte or count ceiling", () =>
  Effect.gen(function* () {
    const { a, connect } = yield* selectiveFixture();
    a.device.files.set("Seed.md", encoded("content"));
    yield* a.engine.sync();
    const saved = a.device.journal;
    const seed = saved?.entries[0];
    if (!saved || !seed) throw new Error("Missing saved entry");
    const entries = Array.from({ length: 10001 }, (_, index) => {
      const id = crypto.randomUUID();
      const path = "Folder/" + index + ".md";
      const file = {
        ...seed.file,
        id,
        path,
        locations: seed.file.locations.map((location) => ({ ...location, path })),
        statePath: seed.file.statePath.replace(seed.file.id, id),
      };
      return { ...seed, file, base: file, localPath: file.path };
    });
    const device = new SelectiveDevice();
    device.journal = { ...saved, entries };
    expect(new TextEncoder().encode(JSON.stringify(device.journal)).length).toBeGreaterThan(
      4 * 1024 * 1024,
    );
    const restored = yield* connect(device);
    expect(restored.engine.details().entries).toHaveLength(10001);
  }),
);
