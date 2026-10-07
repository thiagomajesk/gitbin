import { textContent, binaryContent } from "../src/core/content";
import { describe, expect, it, vi } from "vitest";
import { FileDocument } from "../src/core/file";

function replicas() {
  const left = new FileDocument(crypto.randomUUID());
  left.edit(textContent("Buy milk\nSecond paragraph.\n"));
  left.move("Notes/List.md");
  const right = new FileDocument(left.id, left.stored());
  return { left, right };
}

describe("CRDT text and location registers", () => {
  it("converges atomic file replacements in either update delivery order", () => {
    const seed = new FileDocument(crypto.randomUUID());
    seed.edit(binaryContent(new Uint8Array([0, 255, 1])));
    seed.move("Image.png");
    seed.materialized("Image.png");
    const left = new FileDocument(seed.id, seed.stored());
    const right = new FileDocument(seed.id, seed.stored());
    const a = binaryContent(new Uint8Array([0, 255, 2]));
    const b = binaryContent(new Uint8Array([0, 255, 3]));
    left.captureContent(a);
    right.captureContent(b);
    const first = left.bytes();
    const second = right.bytes();
    left.merge(second);
    right.merge(first);
    left.merge(second);
    expect(left.content).toEqual(right.content);
    expect([a, b]).toContainEqual(left.content);
    const restored = new FileDocument(left.id, left.stored());
    expect(restored.content).toEqual(left.content);
    for (const file of [seed, left, right, restored]) file.destroy();
  });
  it("garbage-collects replaced binary payloads while retaining the latest value", () => {
    const file = new FileDocument(crypto.randomUUID());
    file.edit(binaryContent(new Uint8Array(128000).fill(0)));
    file.move("Large.bin");
    file.materialized("Large.bin");
    for (const value of [1, 2, 3]) {
      file.captureContent(binaryContent(new Uint8Array(128000).fill(value)));
      file.materialized("Large.bin");
    }
    expect(file.bytes().length).toBeLessThan(180000);
    const restored = new FileDocument(file.id, file.stored());
    expect(restored.content).toEqual(binaryContent(new Uint8Array(128000).fill(3)));
    file.destroy();
    restored.destroy();
  });
  it.each([
    ["😀", "😃"],
    ["Before 😀 after", "Before 😃 after"],
    ["🪺 café\n😀", "🪹 café\n😃"],
  ])("preserves replaced Unicode characters through a journal roundtrip", (before, after) => {
    const note = new FileDocument(crypto.randomUUID());
    note.edit(textContent(before));
    note.materialized("Unicode.md");
    note.captureContent(textContent(after));
    const restored = new FileDocument(note.id, note.stored());
    expect(note.content.value).toBe(after);
    expect(restored.content.value).toBe(after);
    expect(restored.baselineContent?.value).toBe(after);
    note.destroy();
    restored.destroy();
  });

  it("preserves concurrent emoji replacements and edits elsewhere", () => {
    const left = new FileDocument(crypto.randomUUID());
    left.edit(textContent("Feeling 😀\nBuy milk\n"));
    left.materialized("Unicode.md");
    const right = new FileDocument(left.id, left.stored());
    left.captureContent(textContent("Feeling 😃\nBuy milk\n"));
    right.captureContent(textContent("Feeling 😀\nBuy milk and bread\n"));
    const first = left.bytes();
    const second = right.bytes();
    left.merge(second);
    right.merge(first);
    const restored = new FileDocument(left.id, left.stored());
    expect(left.content.value).toBe("Feeling 😃\nBuy milk and bread\n");
    expect(right.content.value).toBe(left.content.value);
    expect(restored.content.value).toBe(left.content.value);
    left.destroy();
    right.destroy();
    restored.destroy();
  });

  it("leaves CRDT state and baselines intact when the diff times out", () => {
    const note = new FileDocument(crypto.randomUUID());
    note.edit(textContent("Original 😀"));
    note.materialized("Unicode.md");
    const before = note.stored();
    const clock = vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValue(101);
    try {
      expect(() => note.captureContent(textContent("Updated 😃"))).toThrow("processing limit");
      expect(note.stored()).toEqual(before);
    } finally {
      clock.mockRestore();
    }
    note.captureContent(textContent("Updated 😃"));
    expect(note.content.value).toBe("Updated 😃");
    note.destroy();
  });

  it("restores large Unicode states through native Base64 encoding", () => {
    const note = new FileDocument(crypto.randomUUID());
    const content = "🪺 café\n".repeat(10000);
    note.edit(textContent(content));
    note.move("Large.md");
    note.materialized("Large.md");
    const restored = new FileDocument(note.id, note.stored());
    expect(restored.content.value).toBe(content);
    restored.captureContent(textContent(content + "New ending"));
    expect(restored.content.value).toBe(content + "New ending");
    note.destroy();
    restored.destroy();
  });
  it("captures subsequent saved edits without deleting remote text the editor has not seen", () => {
    const { left, right } = replicas();
    left.materialized("Notes/List.md");
    right.edit(textContent("Buy oat milk\nSecond paragraph.\n"));
    left.merge(right.bytes());
    left.captureContent(textContent("Buy milk and bread\nSecond paragraph.\n"));
    expect(left.content.value).toBe("Buy oat milk and bread\nSecond paragraph.\n");
    const restored = new FileDocument(left.id, left.stored());
    restored.captureContent(
      textContent("Buy milk and bread\nSecond paragraph with local edits.\n"),
    );
    expect(restored.content.value).toContain("Buy oat milk and bread");
    expect(restored.content.value).toContain("with local edits");
    left.destroy();
    right.destroy();
    restored.destroy();
  });
  it("merges offline edits from a shared genesis and is idempotent", () => {
    const { left, right } = replicas();
    left.edit(textContent("Buy milk and bread\nSecond paragraph.\n"));
    right.edit(textContent("Buy oat milk\nSecond paragraph.\n"));
    const first = left.bytes();
    const second = right.bytes();
    left.merge(second);
    right.merge(first);
    left.merge(second);
    expect(left.content.value).toBe("Buy oat milk and bread\nSecond paragraph.\n");
    expect(right.content.value).toBe(left.content.value);
    left.destroy();
    right.destroy();
  });

  it("preserves independent unicode and multiline changes", () => {
    const { left, right } = replicas();
    left.edit(textContent("🪺 Buy milk\nSecond paragraph.\n"));
    right.edit(textContent("Buy milk\nSecond paragraph with café.\n"));
    left.merge(right.bytes());
    right.merge(left.bytes());
    expect(left.content.value).toContain("🪺");
    expect(left.content.value).toContain("café");
    expect(right.content.value).toBe(left.content.value);
    left.destroy();
    right.destroy();
  });

  it("retains concurrent location records until a superseding operation settles them", () => {
    const { left, right } = replicas();
    left.move("A.md");
    right.move("B.md");
    left.merge(right.bytes());
    expect(new Set(left.locations().map(([, location]) => location.path))).toEqual(
      new Set(["A.md", "B.md"]),
    );
    left.move("Resolved.md");
    right.merge(left.bytes());
    expect(right.locations().map(([, location]) => location.path)).toEqual(["Resolved.md"]);
    left.destroy();
    right.destroy();
  });

  it("detects a deletion concurrent with a text edit", () => {
    const { left, right } = replicas();
    left.move(null);
    right.edit(textContent("Buy oat milk\nSecond paragraph.\n"));
    left.merge(right.bytes());
    const location = left.locations()[0]?.[1];
    expect(location).toBeDefined();
    if (location) expect(left.deletionHasEdits(location)).toBe(true);
    left.destroy();
    right.destroy();
  });

  it("refuses paths outside the vault and reserved filenames", () => {
    const note = new FileDocument(crypto.randomUUID());
    for (const path of [
      "../escape.md",
      ".gitbin/escape.md",
      "C:/escape.md",
      "Notes/NUL.md",
      "Notes/a?.md",
    ])
      expect(() => note.move(path)).toThrow();
    note.destroy();
  });
});
