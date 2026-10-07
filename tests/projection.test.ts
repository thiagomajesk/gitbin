import { textContent } from "../src/core/content";
import { expect, it } from "vitest";
import { FileDocument } from "../src/core/file";
import { projectFiles } from "../src/core/projection";

const first = "00000000-0000-0000-0000-000000000001";
const second = "00000000-0000-0000-0000-000000000002";

it("chooses the same concurrent move regardless of update delivery order", () => {
  const seed = new FileDocument(first);
  seed.edit(textContent("Original"));
  seed.move("Original.md");
  const left = new FileDocument(first);
  const right = new FileDocument(first);
  left.merge(seed.bytes());
  right.merge(seed.bytes());
  left.move("Folder/Left.md");
  right.move("Right.md");
  const a = new FileDocument(first);
  const b = new FileDocument(first);
  a.merge(left.bytes());
  a.merge(right.bytes());
  b.merge(right.bytes());
  b.merge(left.bytes());
  expect(projectFiles([a]).files).toEqual(projectFiles([b]).files);
  expect(a.locations()).toHaveLength(1);
  expect(b.locations()).toHaveLength(1);
  for (const note of [seed, left, right, a, b]) note.destroy();
});

it("retains both case-insensitive filename collisions in either iteration order", () => {
  function project(reverse: boolean) {
    const a = new FileDocument(first);
    const b = new FileDocument(second);
    a.edit(textContent("First"));
    a.move("FileDocument.md");
    b.edit(textContent("Second"));
    b.move("note.md");
    const files = projectFiles(reverse ? [b, a] : [a, b]).files;
    a.destroy();
    b.destroy();
    return files;
  }
  const files = project(false);
  expect(files).toEqual(project(true));
  expect(files.size).toBe(2);
  expect(new Set(Array.from(files.values(), (content) => content.value))).toEqual(
    new Set(["First", "Second"]),
  );
});

it("deletes an unchanged note without recovering it", () => {
  const note = new FileDocument(first);
  note.edit(textContent("Original"));
  note.move("Original.md");
  note.move(null);
  expect(projectFiles([note]).files.size).toBe(0);
  note.destroy();
});

it("preserves a concurrent move against deletion", () => {
  const a = new FileDocument(first);
  a.edit(textContent("Original"));
  a.move("Original.md");
  const b = new FileDocument(first);
  b.merge(a.bytes());
  a.move(null);
  b.move("Moved.md");
  a.merge(b.bytes());
  expect(projectFiles([a]).files.get("Moved.md")?.value).toBe("Original");
  a.destroy();
  b.destroy();
});
