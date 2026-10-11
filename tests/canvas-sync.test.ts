import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { parseCanvas } from "../src/core/canvas-data";
import { board, canvasBytes, card } from "./canvas-fixture";
import { encoded, selectiveFixture } from "./selective-fixture";

it.effect("merges Canvas changes across devices after an on-demand download and restart", () =>
  Effect.gen(function* () {
    const { a, connect, repository } = yield* selectiveFixture();
    a.device.files.set("Board.canvas", canvasBytes(board()));
    yield* a.engine.sync();
    const b = yield* connect();
    yield* b.engine.sync();
    expect(b.device.files.get("Board.canvas")?.length).toBe(0);
    expect(repository.downloads).toEqual([]);
    yield* b.engine.download("Board.canvas");
    const left = board();
    left.nodes[0] = { ...card("a"), x: 400 };
    const right = board();
    right.nodes[1] = card("b", "Remote text");
    a.device.files.set("Board.canvas", canvasBytes(left));
    b.device.files.set("Board.canvas", canvasBytes(right));
    yield* a.engine.capture();
    yield* b.engine.capture();
    const resumed = yield* connect(b.device);
    yield* a.engine.sync();
    yield* resumed.engine.sync();
    yield* a.engine.sync();
    const bytes = a.device.files.get("Board.canvas");
    expect(bytes).toEqual(b.device.files.get("Board.canvas"));
    expect(parseCanvas(bytes ?? new Uint8Array()).nodes).toEqual([
      { ...card("a"), x: 400 },
      card("b", "Remote text"),
    ]);
    expect(repository.snapshot.inventory.files).toHaveLength(1);
    expect(repository.snapshot.inventory.files[0]?.kind).toBe("canvas");
    const revision = repository.snapshot.revision;
    yield* a.engine.sync();
    expect(repository.snapshot.revision).toBe(revision);
  }),
);

it.effect("preserves invalid local Canvas and does not upload it", () =>
  Effect.gen(function* () {
    const { a, repository } = yield* selectiveFixture();
    a.device.files.set("Board.canvas", canvasBytes(board()));
    yield* a.engine.sync();
    const revision = repository.snapshot.revision;
    a.device.files.set("Board.canvas", encoded("{broken"));
    const result = yield* a.engine.sync();
    expect(a.device.files.get("Board.canvas")).toEqual(encoded("{broken"));
    expect(repository.snapshot.revision).toBe(revision);
    expect(a.engine.details().issues).toHaveLength(1);
    expect(result.pending).toBe(true);
    a.device.files.set("Board.canvas", canvasBytes(board()));
    expect((yield* a.engine.sync()).pending).toBe(false);
  }),
);

it.effect("adopts structured merging when a JSON file is renamed to Canvas", () =>
  Effect.gen(function* () {
    const { a, repository } = yield* selectiveFixture();
    const bytes = canvasBytes(board());
    a.device.files.set("Board.json", bytes);
    yield* a.engine.sync();
    expect(repository.snapshot.inventory.files[0]?.kind).toBe("binary");
    a.device.files.delete("Board.json");
    a.device.files.set("Board.canvas", bytes);
    yield* a.engine.rename("Board.json", "Board.canvas");
    yield* a.engine.sync();
    expect(repository.snapshot.inventory.files[0]?.kind).toBe("canvas");
    expect(a.device.files.get("Board.canvas")).toEqual(bytes);
  }),
);
