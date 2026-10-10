import { expect, it } from "vitest";
import { BinaryObjects } from "../src/core/blobs";
import { contentHash, textContent } from "../src/core/content";
import { FileDocument } from "../src/core/file";
import { projectFiles } from "../src/core/projection";
import { captureRebasedEdit, reconcileConsolidation } from "../src/core/reconcile";

it("preserves a write racing with materialization after a history reset", () => {
  const blobs = new BinaryObjects();
  const id = crypto.randomUUID();
  const local = new FileDocument(id, undefined, blobs);
  local.edit(textContent("original"));
  local.move("Note.md");
  local.materialized("Note.md");
  const remote = new FileDocument(id, undefined, blobs);
  remote.edit(textContent("incoming edit"));
  remote.move("Note.md");
  const next = reconcileConsolidation(
    new Map([[id, local]]),
    {
      revision: "new",
      vaults: [],
      states: new Map([[id, remote.bytes()]]),
      files: new Map([["Note.md", remote.content]]),
    },
    [{ id, path: "Note.md", hash: contentHash(local.content) }],
    blobs,
  );
  try {
    const disk = new Map([["Note.md", textContent("edit while syncing")]]);
    const restored = new Map(
      [...next].map(([key, file]) => [key, new FileDocument(key, file.stored(), blobs)]),
    );
    try {
      for (const file of [...restored.values()]) captureRebasedEdit(file, disk, restored, blobs);
      expect(
        [...projectFiles(restored.values()).files.values()].map((value) => value.value).sort(),
      ).toEqual(["edit while syncing", "incoming edit"]);
    } finally {
      for (const file of restored.values()) file.destroy();
    }
  } finally {
    local.destroy();
    remote.destroy();
    for (const file of next.values()) file.destroy();
  }
});
