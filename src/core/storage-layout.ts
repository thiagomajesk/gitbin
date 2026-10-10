import * as Y from "yjs";
import { stateLocation } from "./path-rules";
export function statePath(root: string, id: string, bytes: Uint8Array): string {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, bytes);
    const atomic = doc.getMap<{ type?: string }>("content").get("value");
    return stateLocation(root, id, atomic?.type === "binary-ref");
  } finally {
    doc.destroy();
  }
}
