import { diffChars } from "diff";
import { Schema } from "effect";
import * as Y from "yjs";
import { BinaryObjects, StoredContent } from "./blobs";
import {
  contentEqual,
  contentHash,
  decodeBytes as decode,
  encodeBytes as encode,
  type FileContent,
} from "./content";
import { descendingId } from "./order-decisions";
import { Location, type StoredFile, validPath } from "./protocol";

export class FileDocument {
  readonly doc = new Y.Doc();
  baselinePath: string | null;
  baselineContent: FileContent | null;
  baselineState: string | null;

  constructor(
    readonly id: string,
    stored?: StoredFile,
    readonly blobs = new BinaryObjects(),
  ) {
    this.baselinePath = stored?.baselinePath ?? null;
    this.baselineContent = blobs.resolve(stored?.baselineContent ?? null);
    this.baselineState = stored?.baselineState ?? null;
    if (stored) this.merge(decode(stored.state));
  }

  get content(): FileContent {
    const atomic = this.doc.getMap<unknown>("content").get("value");
    if (atomic !== undefined)
      return this.blobs.resolve(Schema.decodeUnknownSync(StoredContent)(atomic)) as FileContent;
    return { type: "text", value: this.doc.getText("text").toJSON() };
  }

  locations(): ReadonlyArray<readonly [string, Location]> {
    const records = Array.from(this.doc.getMap<unknown>("locations").entries()).map(
      ([id, raw]) => [id, Schema.decodeUnknownSync(Location)(raw)] as const,
    );
    const superseded = new Set(records.flatMap(([, record]) => record.parents));
    return records.filter(([id]) => !superseded.has(id));
  }

  move(path: string | null, observedContent = this.content): void {
    if (path !== null && !validPath(path))
      throw new Error("Choose a portable file path without hidden folders.");
    this.doc.getMap("locations").set(crypto.randomUUID(), {
      path,
      parents: this.locations().map(([id]) => id),
      contentHash: contentHash(observedContent),
    } satisfies Location);
  }

  edit(next: FileContent): void {
    if (contentEqual(this.content, next)) return;
    if (next.type === "binary") {
      this.doc.getMap("content").set("value", this.blobs.retain(next));
      return;
    }
    const text = this.doc.getText("text");
    // Compute the complete edit before touching Yjs or advancing saved baselines.
    const changes = diffChars(text.toJSON(), next.value, { timeout: 100 });
    if (!changes)
      throw new Error("Text diff exceeded its processing limit. Saved edits remain pending.");
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

  merge(update: Uint8Array): void {
    Y.applyUpdate(this.doc, update);
    const content = this.doc.getMap<unknown>("content").get("value");
    if (content !== undefined) Schema.decodeUnknownSync(StoredContent)(content);
  }
  captureContent(next: FileContent): void {
    // Saved-file edits are relative to the version the editor actually saw.
    // Diffing against unmaterialized remote changes would turn them into deletions.
    const branch = new FileDocument(this.id, undefined, this.blobs);
    try {
      if (this.baselineState) branch.merge(decode(this.baselineState));
      else branch.merge(this.bytes());
      branch.edit(next);
      this.merge(branch.bytes());
      this.baselineContent = next;
      this.baselineState = encode(branch.bytes());
    } finally {
      branch.destroy();
    }
  }

  materialized(path: string | null): void {
    this.baselinePath = path;
    this.baselineContent = path === null ? null : this.content;
    this.baselineState = encode(this.bytes());
  }
  bytes(): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc);
  }
  stored(): StoredFile {
    return {
      id: this.id,
      state: encode(this.bytes()),
      baselinePath: this.baselinePath,
      baselineContent: this.blobs.retain(this.baselineContent),
      baselineState: this.baselineState,
    };
  }

  binaryIds(includeBaseline = false): string[] {
    const baselineIds: string[] = [];
    if (includeBaseline && this.baselineState && this.baselineContent?.type !== "text") {
      const baseline = new FileDocument(this.id, undefined, this.blobs);
      try {
        baseline.merge(decode(this.baselineState));
        baselineIds.push(...baseline.binaryIds());
      } finally {
        baseline.destroy();
      }
    }
    const content = this.doc.getMap<unknown>("content").get("value");
    if (content === undefined) return baselineIds;
    const reference = Schema.decodeUnknownSync(StoredContent)(content);
    return reference.type === "binary-ref" ? [...baselineIds, reference.value] : baselineIds;
  }

  deletionHasEdits(location: Location): boolean {
    return location.contentHash !== contentHash(this.content);
  }

  previousPath(): string | null {
    const locations = Array.from(this.doc.getMap<unknown>("locations").entries()).sort(
      ([left], [right]) => descendingId(left, right),
    );
    for (const [, raw] of locations) {
      const location = Schema.decodeUnknownSync(Location)(raw);
      if (location.path !== null) return location.path;
    }
    return null;
  }

  destroy(): void {
    this.doc.destroy();
  }
}
