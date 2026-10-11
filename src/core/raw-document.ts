import { diffChars } from "diff";
import * as Y from "yjs";
import { CanvasDocument } from "./canvas-document";
import { type ObjectReference, objectReference } from "./inventory";

/** Content only. Location operations live in the inventory and never require these bytes. */
export class RawDocument {
  private readonly doc = new Y.Doc();

  constructor(state?: Uint8Array) {
    try {
      if (state) this.merge(state);
    } catch (error) {
      this.doc.destroy();
      throw error;
    }
  }

  merge(state: Uint8Array): void {
    Y.applyUpdate(this.doc, state);
  }

  binaryReference(): string | null {
    const value = this.doc.getMap<unknown>("content").get("value");
    if (value === undefined) return null;
    if (
      typeof value !== "object" ||
      value === null ||
      !("type" in value) ||
      !("value" in value) ||
      value.type !== "binary-ref" ||
      typeof value.value !== "string" ||
      !/^[a-f0-9]{40}$/.test(value.value)
    )
      throw new Error("Invalid binary content reference.");
    return value.value;
  }

  textBytes(): Uint8Array {
    if (this.binaryReference() !== null)
      throw new Error("Binary content requires its referenced object.");
    if (this.kind() === "canvas") return new CanvasDocument(this.doc).bytes();
    return new TextEncoder().encode(this.doc.getText("text").toJSON());
  }

  kind(): "text" | "binary" | "canvas" {
    if (this.binaryReference() !== null) return "binary";
    return this.doc.getMap("content").get("kind") === "canvas" ? "canvas" : "text";
  }

  edit(bytes: Uint8Array, kind: "text" | "binary" | "canvas"): void {
    if (kind === "canvas") {
      new CanvasDocument(this.doc).edit(bytes);
      this.doc.getMap("content").delete("value");
      this.doc.getMap("content").set("kind", "canvas");
      return;
    }
    if (kind === "binary") {
      const hash = objectReference(bytes).hash;
      if (hash !== this.binaryReference())
        this.doc.getMap("content").set("value", { type: "binary-ref", value: hash });
      return;
    }
    const next = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    this.doc.getMap("content").delete("kind");
    const text = this.doc.getText("text");
    if (text.length === 0) {
      this.doc.transact(() => {
        this.doc.getMap("content").delete("value");
        text.insert(0, next);
      });
      return;
    }
    const changes = diffChars(text.toJSON(), next);
    this.doc.transact(() => {
      this.doc.getMap("content").delete("value");
      let offset = 0;
      for (const { added, removed, value } of changes) {
        if (removed) text.delete(offset, value.length);
        else {
          if (added) text.insert(offset, value);
          offset += value.length;
        }
      }
    });
  }

  verify(content: ObjectReference): void {
    const binary = this.binaryReference();
    if ((binary ?? objectReference(this.textBytes()).hash) !== content.hash)
      throw new Error("Content differs from its CRDT state.");
  }

  bytes(): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc);
  }
  close(): void {
    this.doc.destroy();
  }
}
