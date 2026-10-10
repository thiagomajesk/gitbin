import type { DataAdapter } from "obsidian";
import { safeStoragePath } from "../core/path-rules";

export function validateStoragePath(path: string): void {
  if (!safeStoragePath(path)) throw new Error("Unsafe storage path.");
}
export async function ensureFolder(adapter: DataAdapter, path: string): Promise<void> {
  validateStoragePath(path);
  const parts = path.split("/");
  for (let index = 1; index <= parts.length; index++) {
    const folder = parts.slice(0, index).join("/");
    if (!(await adapter.exists(folder))) await adapter.mkdir(folder);
  }
}
