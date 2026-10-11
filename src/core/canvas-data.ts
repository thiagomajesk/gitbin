export type CanvasObject = Record<string, unknown>;
export interface CanvasData {
  properties: CanvasObject;
  nodes: CanvasObject[];
  edges: CanvasObject[];
}

export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(
      Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  });
}
function object(value: unknown): CanvasObject {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a Canvas object.");
  return value as CanvasObject;
}
function entities(value: unknown): CanvasObject[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Expected a Canvas array.");
  const result = value.map(object);
  const ids = result.map((entry) => entry.id);
  if (ids.some((id) => typeof id !== "string" || !id) || new Set(ids).size !== ids.length)
    throw new Error("Canvas IDs must be unique nonempty strings.");
  return result;
}
function node(value: CanvasObject): void {
  const content = { text: "text", file: "file", link: "url", group: "label" };
  if (typeof value.type !== "string" || !Object.hasOwn(content, value.type))
    throw new Error("Unsupported Canvas card type.");
  for (const key of ["x", "y", "width", "height"])
    if (!Number.isSafeInteger(value[key])) throw new Error("Invalid Canvas card geometry.");
  const key = content[value.type as keyof typeof content];
  if (value.type !== "group" && typeof value[key] !== "string")
    throw new Error("Missing Canvas card content.");
}
export function parseCanvas(bytes: Uint8Array): CanvasData {
  try {
    const value = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    const nodes = entities(value.nodes);
    const edges = entities(value.edges);
    nodes.forEach(node);
    const ids = new Set(nodes.map((entry) => entry.id));
    for (const edge of edges)
      if (!ids.has(edge.fromNode) || !ids.has(edge.toNode))
        throw new Error("Canvas connection points to a missing card.");
    const { nodes: _nodes, edges: _edges, ...properties } = value;
    return { properties, nodes, edges };
  } catch (cause) {
    throw new Error(
      "Cannot merge this Canvas. Fix its JSON and card or connection data, then sync again. The original file is preserved.",
      { cause },
    );
  }
}
