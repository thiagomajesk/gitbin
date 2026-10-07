import { mkdtemp, readFile, writeFile, mkdir, stat, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DataAdapter } from "obsidian";
import { expect, it, vi } from "vitest";
import { buildCommit, flattenTree, readBlobText, readCommit } from "just-git/repo";
import { gitCache } from "../src/platform/git-cache";
import { gitSession } from "../src/git/session";

const { FileSystemAdapter } = vi.hoisted(() => ({
  FileSystemAdapter: class {
    constructor(readonly root: string) {}
    getFullPath(path: string) {
      return this.root + "/" + path;
    }
  },
}));
vi.mock("obsidian", () => ({ FileSystemAdapter, Platform: { isDesktopApp: true } }));

it("reuses immutable Git objects without repeated disk reads or safety probes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gitbin-cache-profile-"));
  const native = require("node:fs/promises") as typeof import("node:fs/promises");
  const safety = vi.spyOn(native, "lstat");
  let reads = 0;
  const location = (path: string) => join(directory, path);
  const adapter = Object.assign(new FileSystemAdapter(directory), {
    exists: async (path: string) => !!(await stat(location(path)).catch(() => null)),
    stat: async (path: string) => {
      const value = await stat(location(path)).catch(() => null);
      return value
        ? {
            type: value.isDirectory() ? "folder" : "file",
            size: value.size,
            mtime: value.mtimeMs,
            ctime: value.ctimeMs,
          }
        : null;
    },
    mkdir: async (path: string) => {
      await mkdir(location(path));
    },
    read: (path: string) => readFile(location(path), "utf8"),
    readBinary: async (path: string) => {
      reads++;
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
        files: entries.filter((entry) => entry.isFile()).map((entry) => `${path}/${entry.name}`),
        folders: entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => `${path}/${entry.name}`),
      };
    },
  }) as unknown as DataAdapter;
  try {
    const fs = gitCache(adapter, ".obsidian/plugins/gitbin/local/profile/git");
    const connection = {
      fs,
      url: "https://git.example.com/repository.git",
      credentials: () => null,
      identity: { author: { name: "test", email: "test@desktop" }, device: "desktop" },
      network: false,
    };
    const session = gitSession({
      ...connection,
      network: {
        fetch: async () => {
          throw new Error("Unexpected network request");
        },
      },
    });
    const repo = await session.repo();
    const files = Object.fromEntries(
      Array.from({ length: 190 }, (_, index) => [
        `Guide-${index}.md`,
        `# Guide ${index}\n\n${"Explanation of the example.\n".repeat(100)}`,
      ]),
    );
    files["Large.md"] = "# Large document\n" + "A larger example with details.\n".repeat(50000);
    const commit = await buildCommit(repo, {
      files,
      branch: "main",
      message: "profile fixture",
      author: connection.identity.author,
    });
    const entries = await flattenTree(repo, (await readCommit(repo, commit.hash)).tree);
    reads = 0;
    safety.mockClear();
    const started = performance.now();
    for (let pass = 0; pass < 3; pass++)
      for (const entry of entries.values())
        expect((await readBlobText(repo, entry.hash)).length).toBeGreaterThan(0);
    const measurement = {
      elapsedMs: performance.now() - started,
      objectReads: reads,
      safetyProbes: safety.mock.calls.length,
      files: entries.length,
      passes: 3,
    };
    await writeFile(join(directory, "profile.json"), JSON.stringify(measurement));
    expect(measurement.objectReads).toBe(0);
    expect(measurement.safetyProbes).toBe(0);
    const target = "/repo/.git/objects/aa/" + "b".repeat(38);
    await fs.mkdir("/repo/.git/objects/aa", { recursive: true });
    await fs.writeFile(target, new Uint8Array([1, 2, 3]));
    const returned = await fs.readFileBuffer(target);
    returned[0] = 99;
    expect(await fs.readFileBuffer(target)).toEqual(new Uint8Array([1, 2, 3]));
    await fs.rm("/repo/.git/objects/aa", { recursive: true });
    const outside = join(directory, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "b".repeat(38)), "unsafe");
    await symlink(
      outside,
      location(".obsidian/plugins/gitbin/local/profile/git/.git/objects/aa"),
      "junction",
    );
    await expect(fs.readFileBuffer(target)).rejects.toThrow("symbolic links");
  } finally {
    safety.mockRestore();
  }
}, 60000);
