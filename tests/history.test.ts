import { textContent, binaryContent } from "../src/core/content";
import { describe, expect, it } from "vitest";
import { emptyHistory, recordHistory, snapshotFiles, type FileSnapshot } from "../src/core/history";
import { FileDocument } from "../src/core/file";
import { hashText } from "../src/core/hash";

function file(text: string, path: string | null = "List.md"): FileSnapshot {
  return { id: "file", path, text, binary: false, hash: hashText(text) };
}
describe("local sync history", () => {
  it("records opaque file hashes without copying their payloads into history", () => {
    const document = new FileDocument(crypto.randomUUID());
    const bytes = new Uint8Array(200000).fill(0xff);
    document.edit(binaryContent(bytes));
    document.move("Image.png");
    const snapshots = snapshotFiles([document]);
    expect(snapshots[0]).toMatchObject({ binary: true, text: null, path: "Image.png" });
    const state = recordHistory(emptyHistory(), snapshots, [], snapshots, "first");
    expect(JSON.stringify(state).length).toBeLessThan(2000);
    document.destroy();
  });
  it("does not claim a shared baseline or conflict for the first sync", () => {
    const result = recordHistory(emptyHistory(), [file("Local")], [], [file("Local")], "commit");
    expect(result.entries[0]).toMatchObject({
      baselineKnown: false,
      changes: [{ kind: "synced", baseline: null }],
    });
  });
  it("distinguishes incoming updates from combined edits and skips unchanged syncs", () => {
    const base = file("Original");
    const initial = recordHistory(emptyHistory(), [base], [], [base], "first");
    expect(recordHistory(initial, [base], [base], [base], "first")).toBe(initial);
    const updated = file("Incoming");
    const next = recordHistory(initial, [base], [updated], [updated], "second");
    expect(next.entries[0]?.changes[0]?.kind).toBe("incoming");
  });
  it("retains filename and deletion snapshots alongside the final decision", () => {
    const base = file("Original");
    const initial = recordHistory(emptyHistory(), [base], [], [base], "first");
    const local = file("Edited", "Renamed.md");
    const incoming = file("Original", null);
    const next = recordHistory(initial, [local], [incoming], [local], "second");
    expect(next.entries[0]?.changes[0]).toMatchObject({
      kind: "combined",
      baseline: { path: "List.md" },
      local: { path: "Renamed.md" },
      incoming: { path: null },
      result: { path: "Renamed.md", text: "Edited" },
    });
  });
  it("keeps at most 100 sync entries", () => {
    let state = emptyHistory();
    for (let index = 0; index < 110; index++) {
      const next = file(String(index));
      state = recordHistory(state, [next], state.checkpoint ?? [], [next], String(index));
    }
    expect(state.entries).toHaveLength(100);
    expect(state.entries[0]?.revision).toBe("109");
  });
  it("retains complete large comparisons including changes beyond the former cutoff", () => {
    const note = new FileDocument("file");
    note.edit(textContent("x".repeat(31999) + "😀 tail"));
    note.move("List.md");
    const before = snapshotFiles([note]);
    expect(before[0]?.text).toBe("x".repeat(31999) + "😀 tail");
    const initial = recordHistory(emptyHistory(), before, [], before, "first");
    note.edit(textContent("x".repeat(31999) + "😀 changed tail"));
    const after = snapshotFiles([note]);
    const next = recordHistory(initial, after, before, after, "second");
    expect(next.entries[0]?.changes[0]?.baseline?.text).toBe("x".repeat(31999) + "😀 tail");
    expect(next.entries[0]?.changes[0]?.result.text).toBe("x".repeat(31999) + "😀 changed tail");
    note.destroy();
  });
  it("keeps every file comparison intact in a large sync batch", () => {
    const baseline = Array.from({ length: 53 }, (_, index) => ({
      ...file("x".repeat(8000)),
      id: String(index),
      path: `Guide ${index}.md`,
    }));
    const initial = recordHistory(emptyHistory(), baseline, [], baseline, "first");
    const changed = baseline.map((before) => ({
      ...before,
      text: before.text + " changed",
      hash: hashText(before.text + " changed"),
    }));
    const next = recordHistory(initial, changed, baseline, changed, "second");
    expect(next.entries[0]?.changes).toHaveLength(53);
    for (const change of next.entries[0]?.changes ?? []) {
      expect(change.baseline?.text).toBe("x".repeat(8000));
      expect(change.local?.text).toBe("x".repeat(8000) + " changed");
      expect(change.incoming?.text).toBe("x".repeat(8000));
      expect(change.result.text).toBe("x".repeat(8000) + " changed");
    }
  });
  it("bounds total retained preview data as well as entry count", () => {
    let state = emptyHistory();
    for (let index = 0; index < 20; index++) {
      const next = file(String(index) + "x".repeat(32000));
      state = recordHistory(state, [next], state.checkpoint ?? [], [next], String(index));
    }
    expect(JSON.stringify(state.entries).length).toBeLessThanOrEqual(2_500_000);
    expect(state.entries[0]?.revision).toBe("19");
  });
});
