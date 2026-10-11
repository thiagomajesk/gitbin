import { diffArrays, diffChars } from "diff";
import * as Y from "yjs";
import { type CanvasObject, parseCanvas, stableJson } from "./canvas-data";
import { visibleCanvasEntity } from "./canvas-values";

function properties(target: Y.Map<unknown>, next: CanvasObject): void {
  for (const key of target.keys()) if (!Object.hasOwn(next, key)) target.delete(key);
  for (const [key, value] of Object.entries(next))
    if (stableJson(target.get(key)) !== stableJson(value)) target.set(key, value);
}
function editText(text: Y.Text, next: string): void {
  let offset = 0;
  for (const { added, removed, value } of diffChars(text.toJSON(), next)) {
    if (removed) text.delete(offset, value.length);
    else {
      if (added) text.insert(offset, value);
      offset += value.length;
    }
  }
}
function editEntity(record: Y.Map<unknown>, entry: CanvasObject): void {
  let props = record.get("properties") as Y.Map<unknown> | undefined;
  if (!props) {
    props = new Y.Map();
    record.set("properties", props);
  }
  const next = { ...entry };
  if (entry.type === "text") {
    let text = record.get("text") as Y.Text | undefined;
    if (!text) {
      text = new Y.Text();
      record.set("text", text);
    }
    editText(text, entry.text as string);
    delete next.text;
  }
  properties(props, next);
}
function editOrder(order: Y.Array<string>, next: string[]): void {
  let offset = 0;
  for (const { added, removed, value } of diffArrays(order.toArray(), next)) {
    if (removed) order.delete(offset, value.length);
    else {
      if (added) order.insert(offset, value);
      offset += value.length;
    }
  }
}
export class CanvasDocument {
  constructor(private readonly doc: Y.Doc) {}
  private entities(name: string): Y.Map<Y.Map<unknown>> {
    return this.doc.getMap(name);
  }
  private deleted(name: string): Y.Map<boolean> {
    return this.doc.getMap(name + "-deleted");
  }
  private editEntities(name: string, entries: CanvasObject[]): void {
    const records = this.entities(name);
    const deleted = this.deleted(name);
    const ids = new Set(entries.map((entry) => entry.id as string));
    for (const id of records.keys()) if (!ids.has(id) && !deleted.get(id)) deleted.set(id, true);
    for (const entry of entries) {
      const id = entry.id as string;
      let record = records.get(id);
      if (!record) {
        record = new Y.Map();
        records.set(id, record);
      }
      // Only a restore observed after deletion clears its tombstone, never a stale edit.
      if (deleted.get(id)) deleted.set(id, false);
      editEntity(record, entry);
    }
    editOrder(this.doc.getArray(name + "-order"), [...ids]);
  }
  private readEntities(name: string): CanvasObject[] {
    // Concurrent moves can insert the same ID twice. The final occurrence wins
    // in the shared sequence, so every replica renders each card exactly once.
    const order = [
      ...new Set(
        this.doc
          .getArray<string>(name + "-order")
          .toArray()
          .reverse(),
      ),
    ].reverse();
    return order
      .filter((id) => visibleCanvasEntity(this.deleted(name).get(id) === true, false, true, true))
      .map((id) => {
        const record = this.entities(name).get(id);
        if (!record) throw new Error("Missing Canvas entity.");
        const value = (record.get("properties") as Y.Map<unknown>).toJSON();
        if (value.type === "text") value.text = (record.get("text") as Y.Text).toJSON();
        return value;
      });
  }
  private value(): CanvasObject {
    const nodes = this.readEntities("canvas-nodes");
    const ids = new Set(nodes.map((entry) => entry.id));
    const edges = this.readEntities("canvas-edges").filter((entry) =>
      visibleCanvasEntity(false, true, ids.has(entry.fromNode), ids.has(entry.toNode)),
    );
    return { ...this.doc.getMap("canvas-properties").toJSON(), nodes, edges };
  }
  edit(bytes: Uint8Array): void {
    const data = parseCanvas(bytes);
    this.doc.transact(() => {
      properties(this.doc.getMap("canvas-properties"), data.properties);
      this.editEntities("canvas-nodes", data.nodes);
      this.editEntities("canvas-edges", data.edges);
      this.doc.getMap("canvas-source").set("value", {
        raw: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
        canonical: stableJson(this.value()),
      });
    });
  }
  bytes(): Uint8Array {
    const canonical = stableJson(this.value());
    const source = this.doc.getMap("canvas-source").get("value") as
      | { raw: string; canonical: string }
      | undefined;
    const bytes = new TextEncoder().encode(
      source?.canonical === canonical ? source.raw : canonical,
    );
    parseCanvas(bytes);
    return bytes;
  }
}
