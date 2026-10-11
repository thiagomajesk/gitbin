import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { parseCanvas } from "../src/core/canvas-data";
import { board, canvasBytes, card } from "./canvas-fixture";
import { realSelectiveFixture } from "./selective-git-fixture";

it.effect("publishes a merged Canvas through real Git and retains it after consolidation", () =>
  Effect.gen(function* () {
    const fixture = yield* realSelectiveFixture();
    const a = yield* fixture.connect();
    a.device.files.set("Board.canvas", canvasBytes(board()));
    yield* a.engine.sync();
    const b = yield* fixture.connect();
    yield* b.engine.sync();
    const left = board();
    left.nodes[0] = { ...card("a"), x: 250 };
    const right = board();
    right.nodes[1] = card("b", "Git merge");
    a.device.files.set("Board.canvas", canvasBytes(left));
    b.device.files.set("Board.canvas", canvasBytes(right));
    yield* a.engine.capture();
    yield* b.engine.capture();
    yield* a.engine.sync();
    yield* b.engine.sync();
    yield* a.engine.sync();
    const committed = yield* fixture.git(["show", "main:personal/Board.canvas"]);
    expect(parseCanvas(new TextEncoder().encode(committed)).nodes).toEqual([
      { ...card("a"), x: 250 },
      card("b", "Git merge"),
    ]);
    expect(a.device.files.get("Board.canvas")).toEqual(b.device.files.get("Board.canvas"));
    const preview = yield* fixture.maintenance.preview();
    yield* fixture.maintenance.apply(preview.sourceRevision, preview.revision);
    yield* a.engine.sync();
    yield* b.engine.sync();
    expect(yield* fixture.git(["show", "main:personal/Board.canvas"])).toBe(committed);
  }),
);
