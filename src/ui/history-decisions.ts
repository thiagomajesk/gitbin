import type { Change, Snapshot } from "../core/decisions";
export type DiffContent = { name: string; contents: string };
export function diffFile(file: Snapshot | null): DiffContent | null {
  //@ verify
  //@ ensures file === null ==> \result === null
  //@ ensures file !== null ==> (\result === null) === (file.path === null || file.path === "" || file.text === null)
  //@ ensures file !== null ==> \result !== null ==> \result.name === file.path && \result.contents === file.text
  if (file === null) return null;
  if (file.path === null || file.path === "" || file.text === null) return null;
  return { name: file.path, contents: file.text };
}
export function fileName(change: Change): string {
  //@ verify
  //@ ensures change.result.path !== null ==> \result === change.result.path
  //@ ensures change.result.path === null ==> change.baseline === null ==> \result === "Deleted file"
  //@ ensures change.result.path === null ==> \result === baselineName(change.baseline)
  return change.result.path ?? baselineName(change.baseline);
}
function visibleHash(file: Snapshot | null): string | null {
  //@ verify
  //@ ensures file === null ==> \result === null
  //@ ensures file !== null ==> \result === (file.path === null || file.path === "" ? null : file.hash)
  if (file === null) return null;
  return file.path === null || file.path === "" ? null : file.hash;
}
function baselineName(file: Snapshot | null): string {
  //@ verify
  //@ ensures file === null ==> \result === "Deleted file"
  //@ ensures file !== null ==> file.path === null ==> \result === "Deleted file"
  //@ ensures file !== null ==> file.path !== null ==> \result === file.path
  if (file === null) return "Deleted file";
  return file.path ?? "Deleted file";
}
function isBinary(file: Snapshot | null): boolean {
  //@ verify
  //@ ensures file === null ==> !\result
  //@ ensures file !== null ==> \result === file.binary
  if (file === null) return false;
  return file.binary;
}
function hasBinary(change: Change): boolean {
  //@ verify
  //@ ensures \result === (isBinary(change.baseline) || isBinary(change.local) || isBinary(change.incoming) || isBinary(change.result))
  return (
    isBinary(change.baseline) ||
    isBinary(change.local) ||
    isBinary(change.incoming) ||
    isBinary(change.result)
  );
}
function movedPath(baseline: Snapshot | null, result: Snapshot): boolean {
  //@ verify
  //@ ensures baseline === null ==> \result
  //@ ensures baseline !== null ==> \result === (baseline.path !== result.path)
  if (baseline === null) return true;
  return baseline.path !== result.path;
}
function contentsUnchanged(change: Change): boolean {
  //@ verify
  //@ ensures \result === (visibleHash(change.baseline) === visibleHash(change.local) && visibleHash(change.baseline) === visibleHash(change.incoming) && visibleHash(change.baseline) === visibleHash(change.result))
  return (
    visibleHash(change.baseline) === visibleHash(change.local) &&
    visibleHash(change.baseline) === visibleHash(change.incoming) &&
    visibleHash(change.baseline) === visibleHash(change.result)
  );
}
function hasText(file: Snapshot | null): boolean {
  //@ verify
  //@ ensures file === null ==> !\result
  //@ ensures file !== null ==> file.text === null ==> !\result
  //@ ensures file !== null ==> file.text !== null ==> \result === (file.text !== "")
  if (file === null) return false;
  const text = file.text;
  if (text === null) return false;
  return text !== "";
}
export function comparisonSummary(change: Change): string | null {
  //@ verify
  //@ ensures hasBinary(change) ==> \result === "Binary file. No preview available."
  //@ ensures !hasBinary(change) && contentsUnchanged(change) ==> \result === (movedPath(change.baseline, change.result) ? "File moved, contents unchanged." : "Contents unchanged.")
  //@ ensures !hasBinary(change) && !contentsUnchanged(change) && (hasText(change.baseline) || hasText(change.local) || hasText(change.incoming) || hasText(change.result)) ==> \result === null
  //@ ensures !hasBinary(change) && !contentsUnchanged(change) && !hasText(change.baseline) && !hasText(change.local) && !hasText(change.incoming) && !hasText(change.result) ==> \result === (change.result.path !== null && change.result.path !== "" ? "Empty file added." : "Empty file removed.")
  if (hasBinary(change)) return "Binary file. No preview available.";
  if (contentsUnchanged(change))
    return movedPath(change.baseline, change.result)
      ? "File moved, contents unchanged."
      : "Contents unchanged.";
  if (
    hasText(change.baseline) ||
    hasText(change.local) ||
    hasText(change.incoming) ||
    hasText(change.result)
  )
    return null;
  return change.result.path !== null && change.result.path !== ""
    ? "Empty file added."
    : "Empty file removed.";
}

export function previewMatches(file: Snapshot | null, result: Snapshot): boolean {
  //@ verify
  //@ ensures file === null ==> !\result
  //@ ensures file !== null ==> \result === (file.path === result.path && file.text === result.text)
  if (file === null) return false;
  return file.path === result.path && file.text === result.text;
}
