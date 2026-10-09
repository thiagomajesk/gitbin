import * as Y from "yjs";
export function statePath(root: string, id: string, bytes: Uint8Array): string {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, bytes);
    const atomic = doc.getMap<{ type?: string }>("content").get("value");
    const folder = atomic?.type === "binary-ref" ? "attachments" : "notes";
    return ".gitbin/vaults/" + root + "/" + folder + "/" + id + ".bin";
  } finally {
    doc.destroy();
  }
}
