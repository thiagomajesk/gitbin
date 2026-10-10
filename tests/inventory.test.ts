import { expect, it } from "vitest";
import { downloadAdmission } from "../src/core/download-decisions";
import {
  decodeInventory,
  type InventoryFile,
  objectReference,
  verifyObject,
} from "../src/core/inventory";

const bytes = new TextEncoder().encode("Note\n");
function entry(path = "Note.md"): InventoryFile {
  const id = crypto.randomUUID();
  return {
    id,
    path,
    kind: "text",
    statePath: `.gitbin/vaults/personal/notes/${id}.bin`,
    state: objectReference(bytes),
    content: objectReference(bytes),
    locations: [{ id, path, parents: [], contentHash: objectReference(bytes).hash }],
  };
}
function decode(files: unknown[]) {
  return decodeInventory(new TextEncoder().encode(JSON.stringify({ files })), "personal");
}
it("round-trips references and detects byte and size mismatches", () => {
  const file = entry();
  expect(decode([file]).files).toEqual([file]);
  expect(() => verifyObject(bytes, file.content)).not.toThrow();
  expect(() => verifyObject(new TextEncoder().encode("Nope\n"), file.content)).toThrow();
  expect(() => verifyObject(bytes, { ...file.content, bytes: bytes.length + 1 })).toThrow();
});
it.each(["../escape.md", ".obsidian/config.json", "Folder\\Note.md"])(
  "rejects unsafe inventory path %s",
  (path) => {
    expect(() => decode([entry(path)])).toThrow();
  },
);
it("rejects identity, case, and file/folder collisions", () => {
  const file = entry();
  expect(() => decode([file, file])).toThrow();
  expect(() => decode([file, entry("note.md")])).toThrow();
  expect(() => decode([entry("folder"), entry("folder/Note.md")])).toThrow();
});
it("rejects cross-vault references, unknown fields and invalid sizes", () => {
  const file = entry();
  expect(() =>
    decode([{ ...file, statePath: file.statePath.replace("personal", "other") }]),
  ).toThrow();
  expect(() => decode([{ ...file, unexpected: true }])).toThrow();
  for (const size of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1])
    expect(() => decode([{ ...file, content: { ...file.content, bytes: size } }])).toThrow();
});
it("checks the download ceiling, including equality and unlimited", () => {
  expect(downloadAdmission(100, 100)).toBe("allowed");
  expect(downloadAdmission(101, 100)).toBe("content-limit");
  expect(downloadAdmission(0, 100)).toBe("allowed");
  expect(downloadAdmission(1000, Infinity)).toBe("allowed");
});
