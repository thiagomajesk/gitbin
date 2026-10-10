import type { FileSystem } from "just-git";
import type { DataAdapter } from "obsidian";
import { ensureFolder, validateStoragePath } from "./storage";

export function gitCache(adapter: DataAdapter, directory: string): FileSystem {
  const objects = new Map<string, Uint8Array>();
  const limit = 16 * 1024 * 1024;
  let bytes = 0;
  const forget = (value: string) => {
    const previous = objects.get(value);
    if (previous) bytes -= previous.byteLength;
    objects.delete(value);
  };
  const remember = (value: string, content: Uint8Array) => {
    if (!/^\/repo\/\.git\/objects\/[a-f0-9]{2}\/[a-f0-9]{38}$/.test(value)) return;
    forget(value);
    if (content.byteLength > limit) return;
    while (bytes + content.byteLength > limit) {
      const oldest = objects.keys().next().value;
      if (!oldest) break;
      forget(oldest);
    }
    objects.set(value, new Uint8Array(content));
    bytes += content.byteLength;
  };
  const cached = (value: string) => {
    const content = objects.get(value);
    if (content) {
      objects.delete(value);
      objects.set(value, content);
    }
    return content;
  };
  const forgetPath = (value: string) => {
    for (const key of objects.keys())
      if (key === value || key.startsWith(value.replace(/\/+$/, "") + "/")) forget(key);
  };
  const path = (value: string): string => {
    if (value !== "/repo" && !value.startsWith("/repo/"))
      throw new Error("Git cache path is outside its repository.");
    const result = directory + value.replace(/\/+$/, "").slice(5);
    validateStoragePath(result);
    return result;
  };
  return {
    async exists(value) {
      if (value === "/") return true;
      if (value === "/.git" || value === "/HEAD") return false;
      if (cached(value)) return true;
      return adapter.exists(path(value));
    },
    async stat(value) {
      const content = cached(value);
      if (content)
        return {
          isFile: true,
          isDirectory: false,
          isSymbolicLink: false,
          size: content.byteLength,
          mode: 0o100644,
          mtime: new Date(0),
        };
      if (value === "/")
        return {
          isFile: false,
          isDirectory: true,
          isSymbolicLink: false,
          size: 0,
          mode: 0o040755,
          mtime: new Date(0),
        };
      const info = await adapter.stat(path(value));
      if (!info) throw new Error("Git cache entry does not exist.");
      return {
        isFile: info.type === "file",
        isDirectory: info.type === "folder",
        isSymbolicLink: false,
        size: info.size,
        mode: info.type === "folder" ? 0o040755 : 0o100644,
        mtime: new Date(info.mtime),
      };
    },
    async mkdir(value, options) {
      if (value === "/") return;
      const target = path(value);
      if (options?.recursive) await ensureFolder(adapter, target);
      else await adapter.mkdir(target);
    },
    async readdir(value) {
      if (value === "/") return (await adapter.exists(directory)) ? ["repo"] : [];
      const entries = await adapter.list(path(value));
      return [...entries.files, ...entries.folders].map((entry) =>
        entry.slice(entry.lastIndexOf("/") + 1),
      );
    },
    async readFile(value) {
      return adapter.read(path(value));
    },
    async readFileBuffer(value) {
      const saved = cached(value);
      if (saved) return new Uint8Array(saved);
      const content = new Uint8Array(await adapter.readBinary(path(value)));
      remember(value, content);
      return content;
    },
    async writeFile(value, content) {
      const target = path(value);
      forget(value);
      if (typeof content === "string") await adapter.write(target, content);
      else await adapter.writeBinary(target, new Uint8Array(content).buffer);
      remember(value, typeof content === "string" ? new TextEncoder().encode(content) : content);
    },
    async rm(value, options) {
      const target = path(value);
      const info = await adapter.stat(target);
      if (!info) {
        if (options?.force) {
          forgetPath(value);
          return;
        }
        throw new Error("Git cache entry does not exist.");
      }
      if (info.type === "folder") await adapter.rmdir(target, options?.recursive ?? false);
      else await adapter.remove(target);
      forgetPath(value);
    },
  };
}
