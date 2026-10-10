import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { vi } from "vitest";
import { decodeInventory, inventoryPath } from "../src/core/inventory";
import { RawDocument } from "../src/core/raw-document";
import { createMigrationEngine } from "../src/maintenance/engine";
import { reinitializationRoots, reinitializeRepository } from "../src/maintenance/reinitialize";
import type { MigrationSnapshot } from "../src/maintenance/types";

const source: MigrationSnapshot = {
  kind: "repository",
  files: new Map([
    ["personal/Note.md", new TextEncoder().encode("keep")],
    ["personal/.obsidian/config.json", new TextEncoder().encode("hidden")],
    [".gitbin/metadata.json", new TextEncoder().encode("broken")],
    ["unlisted/File.md", new TextEncoder().encode("unlisted")],
  ]),
};
it.effect("rebuilds each document once through the maintenance engine", () =>
  Effect.gen(function* () {
    const edit = vi.spyOn(RawDocument.prototype, "edit");
    try {
      const result = yield* createMigrationEngine().prepare(source, null, ["personal"]);
      expect(edit).toHaveBeenCalledTimes(1);
      expect(result.consolidationHash).toHaveLength(64);
      expect(result.vaults).toEqual(["personal"]);
      expect(result.repository.files.get("personal/Note.md")).toEqual(
        source.files.get("personal/Note.md"),
      );
    } finally {
      edit.mockRestore();
    }
  }),
);
it("discovers vaults from paths and rebuilds current content-only documents", () => {
  const roots = reinitializationRoots([".gitbin/vaults/personal/broken.bin"], ["empty"]);
  const result = reinitializeRepository(source, roots);
  const file = decodeInventory(
    result.files.get(inventoryPath("personal")) ?? new Uint8Array(),
    "personal",
  ).files[0];
  if (!file) throw new Error("Missing rebuilt file");
  const doc = new RawDocument(result.files.get(file.statePath));
  try {
    expect(new TextDecoder().decode(doc.textBytes())).toBe("keep");
    expect(
      decodeInventory(result.files.get(inventoryPath("empty")) ?? new Uint8Array(), "empty").files,
    ).toEqual([]);
  } finally {
    doc.close();
  }
});
it("leaves source, hidden files and unlisted folders unchanged", () => {
  const before = structuredClone(source);
  const result = reinitializeRepository(source, ["personal"]);
  expect(source).toEqual(before);
  for (const [path, bytes] of source.files)
    if (!path.startsWith(".gitbin/")) expect(result.files.get(path)).toEqual(bytes);
  expect([...result.files.keys()].filter((path) => path.startsWith(".gitbin/")).length).toBe(3);
});
it.each([[], ["../personal"], [".gitbin"], ["personal", "Personal"], ["personal/sub"]])(
  "rejects unsafe or ambiguous roots %j",
  (...roots) => {
    expect(() => reinitializeRepository(source, roots)).toThrow();
  },
);
