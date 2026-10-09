import { expect, it } from "vitest";
import { reinitializeRepository } from "../src/maintenance/reinitialize";
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
it("leaves source, hidden files and unlisted folders unchanged", () => {
  const before = structuredClone(source);
  const result = reinitializeRepository(source, ["personal"]);
  expect(source).toEqual(before);
  for (const [path, bytes] of source.files)
    if (!path.startsWith(".gitbin/")) expect(result.files.get(path)).toEqual(bytes);
  expect([...result.files.keys()].filter((path) => path.startsWith(".gitbin/")).length).toBe(2);
});
it.each([[], ["../personal"], [".gitbin"], ["personal", "Personal"], ["personal/sub"]])(
  "rejects unsafe or ambiguous roots %j",
  (...roots) => {
    expect(() => reinitializeRepository(source, roots)).toThrow();
  },
);
