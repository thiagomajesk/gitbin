import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { parseCanvas } from "../src/core/canvas-data";
import { objectReference } from "../src/core/inventory";
import { board, canvasBytes, canvasDocument, canvasPair, card } from "./canvas-fixture";

it.effect("merges independent Canvas properties and text in either delivery order", () =>
  Effect.gen(function* () {
    const { a, b } = yield* canvasPair();
    const left = board();
    left.nodes[0] = { ...card("a", "A Base"), x: 200 };
    const right = board();
    right.nodes[0] = card("a", "Base B");
    right.nodes[1] = { ...card("b"), y: 300 };
    a.edit(canvasBytes(left), "canvas");
    b.edit(canvasBytes(right), "canvas");
    const update = a.bytes();
    a.merge(b.bytes());
    b.merge(update);
    expect(a.textBytes()).toEqual(b.textBytes());
    expect(parseCanvas(a.textBytes()).nodes).toEqual([
      { ...card("a", "A Base B"), x: 200 },
      { ...card("b"), y: 300 },
    ]);
    a.verify(objectReference(a.textBytes()));
  }),
);

it.effect("deletion beats concurrent card edits and removes dangling connections", () =>
  Effect.gen(function* () {
    const { a, b } = yield* canvasPair();
    const left = board();
    left.nodes = [card("b")];
    left.edges = [];
    const right = board();
    right.nodes[0] = card("a", "offline edit");
    right.edges.push({ id: "new", fromNode: "b", toNode: "a" });
    a.edit(canvasBytes(left), "canvas");
    b.edit(canvasBytes(right), "canvas");
    a.merge(b.bytes());
    b.merge(a.bytes());
    expect(parseCanvas(a.textBytes()).nodes).toEqual([card("b")]);
    expect(parseCanvas(a.textBytes()).edges).toEqual([]);
    expect(a.textBytes()).toEqual(b.textBytes());
    b.edit(canvasBytes({ ...right, nodes: [card("b")], edges: [] }), "canvas");
    b.edit(canvasBytes(board()), "canvas");
    a.merge(b.bytes());
    expect(parseCanvas(a.textBytes()).nodes).toHaveLength(2);
  }),
);

it.effect("preserves bytes, unknown fields and stacking order through independent additions", () =>
  Effect.gen(function* () {
    const base = yield* canvasDocument();
    const original = canvasBytes({
      ...board(),
      nodes: [{ ...card("b"), extension: [1, 2] }, card("a")],
    });
    base.edit(original, "canvas");
    expect(base.textBytes()).toEqual(original);
    const other = yield* canvasDocument(base.bytes());
    const left = { ...board(), nodes: [{ ...card("b"), extension: [1, 2] }, card("a"), card("c")] };
    const right = { ...left, nodes: [left.nodes[0], left.nodes[1], card("d")] };
    base.edit(canvasBytes(left), "canvas");
    other.edit(canvasBytes(right), "canvas");
    base.merge(other.bytes());
    other.merge(base.bytes());
    const result = parseCanvas(base.textBytes());
    expect(result.nodes.slice(0, 2).map((node) => node.id)).toEqual(["b", "a"]);
    expect(
      result.nodes
        .slice(2)
        .map((node) => node.id)
        .sort(),
    ).toEqual(["c", "d"]);
    expect(result.nodes[0]?.extension).toEqual([1, 2]);
    expect(result.properties).toEqual({ custom: { untouched: true } });
    expect(base.textBytes()).toEqual(other.textBytes());
  }),
);

it.effect("rejects invalid Canvas before mutating the editing state", () =>
  Effect.gen(function* () {
    const { a } = yield* canvasPair();
    const before = a.bytes();
    for (const invalid of [
      "{",
      JSON.stringify({ nodes: [card("a"), card("a")] }),
      JSON.stringify({ ...board(), nodes: [] }),
    ]) {
      expect(() => a.edit(new TextEncoder().encode(invalid), "canvas")).toThrow(
        "original file is preserved",
      );
      expect(a.bytes()).toEqual(before);
    }
  }),
);

it.effect("converges same-property races while preserving independent connection edits", () =>
  Effect.gen(function* () {
    const { a, b } = yield* canvasPair();
    const left = {
      ...board(),
      nodes: [{ ...card("a"), color: "1" }, card("b")],
      edges: [{ id: "edge", fromNode: "a", toNode: "b", label: "left" }],
    };
    const right = {
      ...board(),
      nodes: [{ ...card("a"), color: "2" }, card("b")],
      edges: [{ id: "edge", fromNode: "a", toNode: "b", color: "3" }],
    };
    a.edit(canvasBytes(left), "canvas");
    b.edit(canvasBytes(right), "canvas");
    const update = a.bytes();
    a.merge(b.bytes());
    b.merge(update);
    const result = parseCanvas(a.textBytes());
    expect(["1", "2"]).toContain(result.nodes[0]?.color);
    expect(result.edges[0]).toEqual({
      id: "edge",
      fromNode: "a",
      toNode: "b",
      label: "left",
      color: "3",
    });
    expect(a.textBytes()).toEqual(b.textBytes());
  }),
);

it.effect("retains file, link and group cards and respects an explicit stacking change", () =>
  Effect.gen(function* () {
    const document = yield* canvasDocument();
    const nodes = [
      { ...card("file"), type: "file", file: "Note.md", subpath: "#Heading" },
      { ...card("link"), type: "link", url: "https://example.com" },
      { ...card("group"), type: "group", label: "Group", background: "Image.png" },
    ];
    document.edit(canvasBytes({ nodes, edges: [] }), "canvas");
    const other = yield* canvasDocument(document.bytes());
    document.edit(canvasBytes({ nodes: [...nodes].reverse(), edges: [] }), "canvas");
    other.edit(
      canvasBytes({ nodes: nodes.map((node) => ({ ...node, x: 200 })), edges: [] }),
      "canvas",
    );
    document.merge(other.bytes());
    expect(parseCanvas(document.textBytes()).nodes).toEqual(
      [...nodes].reverse().map((node) => ({ ...node, x: 200 })),
    );
  }),
);

it.effect("keeps existing stacking order across simultaneous deletion and insertion", () =>
  Effect.gen(function* () {
    const a = yield* canvasDocument();
    const original = { nodes: [card("a"), card("b"), card("c")], edges: [] };
    a.edit(canvasBytes(original), "canvas");
    const b = yield* canvasDocument(a.bytes());
    a.edit(canvasBytes({ nodes: [card("b"), card("c")], edges: [] }), "canvas");
    b.edit(
      canvasBytes({ nodes: [card("a"), card("d"), card("b"), card("c")], edges: [] }),
      "canvas",
    );
    const update = a.bytes();
    a.merge(b.bytes());
    b.merge(update);
    expect(parseCanvas(a.textBytes()).nodes.map((node) => node.id)).toEqual(["d", "b", "c"]);
    expect(a.textBytes()).toEqual(b.textBytes());
  }),
);

it.effect("converges concurrent moves without duplicate cards", () =>
  Effect.gen(function* () {
    const a = yield* canvasDocument();
    a.edit(canvasBytes({ nodes: [card("a"), card("b"), card("c")], edges: [] }), "canvas");
    const b = yield* canvasDocument(a.bytes());
    a.edit(canvasBytes({ nodes: [card("b"), card("a"), card("c")], edges: [] }), "canvas");
    b.edit(canvasBytes({ nodes: [card("b"), card("c"), card("a")], edges: [] }), "canvas");
    const update = a.bytes();
    a.merge(b.bytes());
    b.merge(update);
    const nodes = parseCanvas(a.textBytes()).nodes;
    expect(nodes.map((node) => node.id).sort()).toEqual(["a", "b", "c"]);
    expect(a.textBytes()).toEqual(b.textBytes());
  }),
);
