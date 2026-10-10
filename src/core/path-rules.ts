function invalidSegment(part: string): boolean {
  //@ verify
  //@ ensures \result === (part === ".." || part === "." || part === "")
  return part === ".." || part === "." || part === "";
}
function traversalPath(path: string): boolean {
  //@ verify
  //@ ensures \result === (invalidSegment(path) || path.startsWith("./") || path.startsWith("../") || path.endsWith("/.") || path.endsWith("/..") || path.includes("/./") || path.includes("/../"))
  return (
    invalidSegment(path) ||
    path.startsWith("./") ||
    path.startsWith("../") ||
    path.endsWith("/.") ||
    path.endsWith("/..") ||
    path.includes("/./") ||
    path.includes("/../")
  );
}
export function safeStoragePath(path: string): boolean {
  //@ verify
  //@ ensures \result === (!traversalPath(path) && !path.startsWith("/") && !path.endsWith("/") && !path.includes("//") && !path.includes("\\"))
  return (
    !traversalPath(path) &&
    !path.startsWith("/") &&
    !path.endsWith("/") &&
    !path.includes("//") &&
    !path.includes("\\")
  );
}
export function hiddenPath(path: string): boolean {
  //@ verify
  //@ ensures \result === (path.startsWith(".") || path.includes("/."))
  return path.startsWith(".") || path.includes("/.");
}
export function metadataEntry(path: string): boolean {
  //@ verify
  //@ ensures \result === (path === ".gitbin" || path.startsWith(".gitbin/"))
  return path === ".gitbin" || path.startsWith(".gitbin/");
}
export function overlaps(left: string, right: string): boolean {
  //@ verify
  //@ ensures \result === (left === right || left.startsWith(right + "/") || right.startsWith(left + "/"))
  //@ ensures \result === overlaps(right, left)
  return left === right || left.startsWith(right + "/") || right.startsWith(left + "/");
}
export function stateLocation(root: string, id: string, binary: boolean): string {
  //@ verify
  //@ ensures binary ==> \result === ".gitbin/vaults/" + root + "/attachments/" + id + ".bin"
  //@ ensures !binary ==> \result === ".gitbin/vaults/" + root + "/notes/" + id + ".bin"
  return ".gitbin/vaults/" + root + (binary ? "/attachments/" : "/notes/") + id + ".bin";
}

export function safeSnapshotPath(path: string): boolean {
  //@ verify
  //@ ensures \result === (safeStoragePath(path) && path !== ".git" && !path.startsWith(".git/") && !path.endsWith("/.git") && !path.includes("/.git/"))
  return (
    safeStoragePath(path) &&
    path !== ".git" &&
    !path.startsWith(".git/") &&
    !path.endsWith("/.git") &&
    !path.includes("/.git/")
  );
}

export function renamedPath(
  baseline: string | null,
  previous: string,
  next: string,
): string | null {
  //@ verify
  //@ ensures baseline === null ==> \result === null
  //@ ensures baseline !== null ==> baseline === previous ==> \result === next
  //@ ensures baseline !== null ==> baseline !== previous && baseline.startsWith(previous + "/") ==> \result === next + baseline.slice(previous.length)
  //@ ensures baseline !== null ==> baseline !== previous && !baseline.startsWith(previous + "/") ==> \result === null
  if (baseline === null) return null;
  if (baseline === previous) return next;
  if (baseline.startsWith(previous + "/")) return next + baseline.slice(previous.length);
  return null;
}
