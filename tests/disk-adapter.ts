import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DataAdapter } from "obsidian";
export function diskAdapter(root: string, onRead: () => void = () => {}): DataAdapter {
  const location = (path: string) => join(root, path);
  return {
    exists: async (path: string) => !!(await stat(location(path)).catch(() => null)),
    stat: async (path: string) => {
      const info = await stat(location(path)).catch(() => null);
      return info
        ? {
            type: info.isDirectory() ? "folder" : "file",
            size: info.size,
            mtime: info.mtimeMs,
            ctime: info.ctimeMs,
          }
        : null;
    },
    mkdir: async (path: string) => {
      await mkdir(location(path));
    },
    read: (path: string) => readFile(location(path), "utf8"),
    readBinary: async (path: string) => {
      onRead();
      return new Uint8Array(await readFile(location(path))).buffer;
    },
    write: (path: string, text: string) => writeFile(location(path), text),
    writeBinary: (path: string, bytes: ArrayBuffer) =>
      writeFile(location(path), new Uint8Array(bytes)),
    remove: (path: string) => rm(location(path)),
    rmdir: (path: string, recursive: boolean) => rm(location(path), { recursive }),
    list: async (path: string) => {
      const entries = await readdir(location(path), { withFileTypes: true });
      return {
        files: entries.filter((entry) => entry.isFile()).map((entry) => path + "/" + entry.name),
        folders: entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => path + "/" + entry.name),
      };
    },
  } as DataAdapter;
}
