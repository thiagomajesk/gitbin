import { Effect } from "effect";
import { RawDocument } from "../src/core/raw-document";
import { encoded } from "./selective-fixture";

export const card = (id: string, text = "Base") => ({
  id,
  type: "text",
  text,
  x: 0,
  y: 0,
  width: 200,
  height: 100,
});
export const board = () => ({
  nodes: [card("a"), card("b")],
  edges: [{ id: "edge", fromNode: "a", toNode: "b" }],
  custom: { untouched: true },
});
export const canvasBytes = (value: unknown) => encoded(JSON.stringify(value, null, 2));
export const canvasDocument = (state?: Uint8Array) =>
  Effect.acquireRelease(
    Effect.sync(() => new RawDocument(state)),
    (document) => Effect.sync(() => document.close()),
  );
export const canvasPair = Effect.fn("fixture.canvasPair")(function* () {
  const base = yield* canvasDocument();
  base.edit(canvasBytes(board()), "canvas");
  const a = yield* canvasDocument(base.bytes());
  const b = yield* canvasDocument(base.bytes());
  return { a, b };
});
