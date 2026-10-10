import { sha1 } from "@noble/hashes/legacy.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { Schema } from "effect";
import { binaryContent, contentBytes, type FileContent } from "./content";

export const BlobId = Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/));
const BinaryReference = Schema.Struct({
  type: Schema.Literal("binary-ref"),
  value: BlobId,
});
export const StoredContent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("text"), value: Schema.String }),
  BinaryReference,
]);
export type StoredContent = typeof StoredContent.Type;

export function blobId(content: FileContent): string {
  const bytes = contentBytes(content);
  return bytesToHex(
    sha1
      .create()
      .update(new TextEncoder().encode("blob " + bytes.length + "\0"))
      .update(bytes)
      .digest(),
  );
}

export class BinaryObjects {
  private readonly objects = new Map<string, FileContent>();

  retain(content: FileContent | null): StoredContent | null {
    if (content === null) return null;
    if (content.type === "text") return { type: "text", value: content.value };
    const value = blobId(content);
    this.objects.set(value, content);
    return { type: "binary-ref", value };
  }

  resolve(content: StoredContent | null): FileContent | null {
    if (content?.type !== "binary-ref") return content;
    const found = this.objects.get(content.value);
    if (!found) throw new Error("Missing binary blob: " + content.value);
    return found;
  }

  import(objects: ReadonlyMap<string, FileContent>): void {
    for (const [id, content] of objects) {
      Schema.decodeUnknownSync(BlobId)(id);
      if (content.type !== "binary" || blobId(content) !== id)
        throw new Error("Invalid binary blob: " + id);
      this.objects.set(id, content);
    }
  }

  retainOnly(ids: readonly string[]): void {
    const required = new Set(ids);
    for (const id of this.objects.keys()) if (!required.has(id)) this.objects.delete(id);
  }

  select(ids: Iterable<string>): Map<string, FileContent> {
    return new Map(
      Array.from(new Set(ids), (id) => [
        id,
        this.resolve({ type: "binary-ref", value: id }) as FileContent,
      ]),
    );
  }
}

export const binaryObject = (id: string, bytes: Uint8Array): FileContent => {
  const content = binaryContent(bytes);
  if (blobId(content) !== id) throw new Error("Invalid binary blob: " + id);
  return content;
};
