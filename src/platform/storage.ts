import type { DataAdapter } from "obsidian";
function invalidSegment(part: string): boolean {
  return part === ".." || part === "." || !part;
}
export function validateStoragePath(path: string): void {
  const invalid = [
    !path,
    path.startsWith("/"),
    path.includes("\\"),
    path.split("/").some(invalidSegment),
  ].some(Boolean);
  if (invalid) throw new Error("Unsafe storage path.");
}
export async function ensureFolder(adapter: DataAdapter, path: string): Promise<void> {
  validateStoragePath(path);
  const parts = path.split("/");
  for (let index = 1; index <= parts.length; index++) {
    const folder = parts.slice(0, index).join("/");
    if (!(await adapter.exists(folder))) await adapter.mkdir(folder);
  }
}
