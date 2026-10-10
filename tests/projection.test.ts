import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { mergeLocations, moveRecord, reconcileLocations } from "../src/core/locations";
import { encoded, selectiveFixture } from "./selective-fixture";

it.effect(
  "resolves concurrent moves regardless of delivery order and preserves moves against deletion",
  () =>
    Effect.gen(function* () {
      const { a } = yield* selectiveFixture();
      a.device.files.set("Original.md", encoded("Original"));
      yield* a.engine.capture();
      const file = a.device.journal?.entries[0]?.file;
      if (!file) throw new Error("Missing captured file");
      const left = moveRecord(file, "Left.md");
      const right = moveRecord(file, "Right.md");
      const first = reconcileLocations({ ...file, locations: mergeLocations(left, right) });
      const second = reconcileLocations({ ...file, locations: mergeLocations(right, left) });
      expect(first.path).toBe(second.path);
      const deleted = moveRecord(file, null);
      expect(reconcileLocations(deleted).path).toBeNull();
      expect(reconcileLocations({ ...file, locations: mergeLocations(deleted, left) }).path).toBe(
        "Left.md",
      );
    }),
);
