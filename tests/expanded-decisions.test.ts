import { expect, it, vi } from "vitest";
import { credentialScope, matchingSavedCredentials } from "../src/auth/credential-decisions";
import { BinaryObjects } from "../src/core/blobs";
import { contentEqual, textContent } from "../src/core/content";
import { FileDocument } from "../src/core/file";
import { hiddenPath, overlaps, safeStoragePath } from "../src/core/path-rules";
import { captureRebasedEdit, reconcileConsolidation } from "../src/core/reconcile";
import { conflict, writeDisposition } from "../src/core/reconcile-decisions";
import { publicationState, sameConsolidation } from "../src/git/publication-decisions";
import { comparisonSummary, previewMatches } from "../src/ui/history-decisions";
import { acknowledgementsAccepted, repositoryState, syncState } from "../src/ui/status-decisions";

function pathSamples(): string[] {
  let values = [""];
  for (let size = 0; size < 4; size++)
    values = values.flatMap((prefix) => [
      prefix,
      ...["a", ".", "/", "\\", "😀", "\ud800"].map((char) => prefix + char),
    ]);
  return values;
}
it("preserves storage traversal and hidden-path decisions across short paths and UTF-16 edge cases", () => {
  for (const path of pathSamples()) {
    const segments = path.split("/");
    const unsafe =
      !path ||
      path.startsWith("/") ||
      path.includes("\\") ||
      segments.some((part) => part === ".." || part === "." || !part);
    expect(safeStoragePath(path), path).toBe(!unsafe);
    expect(hiddenPath(path), path).toBe(segments.some((part) => part.startsWith(".")));
  }
});
it("keeps optional content semantics and the original text bytes", () => {
  expect(contentEqual(undefined, null)).toBe(true);
  expect(contentEqual(null, textContent(""))).toBe(false);
  expect(contentEqual({ type: "binary", value: "same" }, textContent("same"))).toBe(false);
  expect(textContent("\ufeff😀\ud800").value).toBe("\ufeff😀\ud800");
});
it("distinguishes a missing reconciliation baseline from a recorded deletion", () => {
  expect(conflict(null, "note", null, false)).toBe(true);
  expect(conflict(null, "note", null, true)).toBe(false);
  expect(conflict("own", "remote", "base", true)).toBe(true);
  expect(writeDisposition(true, false, false)).toBe("blocked");
  expect(writeDisposition(true, false, true)).toBe("unchanged");
  expect(writeDisposition(false, false, false)).toBe("write");
});
it("does not reuse credentials for a different repository or username", () => {
  const credentials = { type: "basic" as const, username: "alice", password: "secret" };
  const saved = { remote: "repo", credentials };
  expect(matchingSavedCredentials("repo", "alice", saved)).toBe(credentials);
  expect(matchingSavedCredentials("other", "alice", saved)).toBeNull();
  expect(matchingSavedCredentials("repo", "bob", saved)).toBeNull();
  expect(credentialScope("https://host", "/repo", "https://host", "/repo/child")).toBe(false);
});
it("keeps publication acknowledgement ahead of stale detection", () => {
  expect(publicationState("new", "new", "new")).toBe("complete");
  expect(publicationState("old", "old", "new")).toBe("pending");
  expect(publicationState(null, "old", "new")).toBe("stale");
  expect(publicationState("other", "old", "new")).toBe("inspect");
  expect(sameConsolidation("", "")).toBe(false);
  expect(sameConsolidation("reset", "reset")).toBe(true);
});
it("recognizes ancestor collisions without treating similar prefixes as ancestors", () => {
  expect(overlaps("a", "a/note")).toBe(true);
  expect(overlaps("a/note", "a")).toBe(true);
  expect(overlaps("a", "ab/note")).toBe(false);
});
it("preserves empty-file and missing-baseline preview distinctions", () => {
  const file = { id: "id", path: "note", text: "", hash: "empty", binary: false };
  const change = {
    kind: "synced" as const,
    baseline: null,
    local: null,
    incoming: null,
    result: file,
  };
  expect(comparisonSummary(change)).toBe("Empty file added.");
  expect(comparisonSummary({ ...change, result: { ...file, path: null } })).toBe(
    "File moved, contents unchanged.",
  );
  expect(comparisonSummary({ ...change, result: { ...file, binary: true } })).toBe(
    "Binary file. No preview available.",
  );
  expect(previewMatches(null, { ...file, path: null, text: null })).toBe(false);
});
it("keeps status precedence and requires every acknowledgement", () => {
  expect(repositoryState(false, null, false)).toBe("Connected");
  expect(repositoryState(true, null, true)).toBe("Not verified");
  expect(syncState(true, true, "Migration required", "Syncing…", true, true, "Connected")).toBe(
    "Migration required",
  );
  expect(syncState(false, true, "Migration required", "Syncing…", true, true, "Connected")).toBe(
    "Not connected",
  );
  expect(acknowledgementsAccepted([true, true, true])).toBe(true);
  expect(acknowledgementsAccepted([true, false, true])).toBe(false);
});

it("does not decode remote content when a rebased local file has not changed", () => {
  const file = new FileDocument("unchanged");
  file.baselinePath = "note";
  file.baselineContent = textContent("same");
  const read = vi.spyOn(file, "content", "get").mockImplementation(() => {
    throw new Error("Unexpected content read");
  });
  try {
    expect(captureRebasedEdit(file, new Map(), new Map(), new BinaryObjects())).toBe(false);
    expect(
      captureRebasedEdit(
        file,
        new Map([["note", textContent("same")]]),
        new Map(),
        new BinaryObjects(),
      ),
    ).toBe(false);
    expect(read).not.toHaveBeenCalled();
  } finally {
    file.destroy();
  }
});
it("does not read the content of an untracked deletion during consolidation replay", () => {
  const file = new FileDocument("deleted");
  file.move(null);
  const read = vi.spyOn(file, "content", "get").mockImplementation(() => {
    throw new Error("Unexpected content read");
  });
  try {
    const result = reconcileConsolidation(
      new Map([[file.id, file]]),
      { revision: null, vaults: [], states: new Map(), files: new Map() },
      null,
      new BinaryObjects(),
    );
    expect(result.size).toBe(0);
    expect(read).not.toHaveBeenCalled();
  } finally {
    file.destroy();
  }
});
