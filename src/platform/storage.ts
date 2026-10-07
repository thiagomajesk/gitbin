import type { DataAdapter } from "obsidian";
import { FileSystemAdapter, Platform } from "obsidian";
function invalidSegment(part: string): boolean {
  return part === ".." || part === "." || !part;
}
function validateStoragePath(path: string): void {
  const invalid = [
    !path,
    path.startsWith("/"),
    path.includes("\\"),
    path.split("/").some(invalidSegment),
  ].some(Boolean);
  if (invalid) throw new Error("Unsafe storage path.");
}
function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
async function rejectSymlink(path: string): Promise<void> {
  const { lstat } = require("node:fs/promises") as typeof import("node:fs/promises");
  try {
    if ((await lstat(path)).isSymbolicLink())
      throw new Error("Gitbin does not follow symbolic links.");
  } catch (error) {
    if (!missing(error)) throw error;
  }
}
export async function safeStorage(adapter: DataAdapter, path: string): Promise<void> {
  validateStoragePath(path);
  if (!Platform.isDesktopApp) return;
  if (!(adapter instanceof FileSystemAdapter))
    throw new Error("Unsupported desktop storage adapter.");
  const parts = path.split("/");
  await Promise.all([
    rejectSymlink(adapter.getFullPath("")),
    ...parts.map((_, index) =>
      rejectSymlink(adapter.getFullPath(parts.slice(0, index + 1).join("/"))),
    ),
  ]);
}
export async function ensureFolder(adapter: DataAdapter, path: string): Promise<void> {
  await safeStorage(adapter, path);
  const parts = path.split("/");
  for (let index = 1; index <= parts.length; index++) {
    const folder = parts.slice(0, index).join("/");
    if (!(await adapter.exists(folder))) await adapter.mkdir(folder);
  }
}
