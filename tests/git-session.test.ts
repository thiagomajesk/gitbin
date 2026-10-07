import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, writeFile, mkdir, stat, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DataAdapter } from "obsidian";
import { Effect } from "effect";
import { expect, it, vi } from "vitest";
import { gitCache } from "../src/platform/git-cache";
import { gitSession } from "../src/git/session";
import { createGitRemote } from "../src/git/remote";
import { gitServer } from "./git-server";

vi.mock("obsidian", () => ({ Platform: { isDesktopApp: false } }));

function diskAdapter(root: string): DataAdapter {
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
    readBinary: async (path: string) => new Uint8Array(await readFile(location(path))).buffer,
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
const identity = { author: { name: "alice", email: "alice@Laptop" }, device: "Laptop" };
function git(directory: string, args: string[]) {
  return execFileSync("git", args, { cwd: directory, encoding: "utf8" }).trim();
}

it("persists binary cache files and rejects paths escaping its private directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gitbin-cache-"));
  const adapter = diskAdapter(directory);
  const cache = gitCache(adapter, "local/git");
  await cache.mkdir("/repo/objects", { recursive: true });
  const bytes = new Uint8Array([0, 255, 123, 10]);
  await cache.writeFile("/repo/objects/blob", bytes);
  const reopened = gitCache(adapter, "local/git");
  expect(await reopened.readFileBuffer("/repo/objects/blob")).toEqual(bytes);
  expect(await reopened.readdir("/repo/objects")).toEqual(["blob"]);
  for (const path of [
    "/other/file",
    "/repo/../outside",
    "/repo/objects/../../outside",
    "/repo/file\\outside",
  ])
    await expect(reopened.writeFile(path, "bad")).rejects.toThrow();
  await reopened.rm("/repo/missing", { force: true });
  await expect(reopened.rm("/repo/objects")).rejects.toThrow();
  await reopened.rm("/repo/objects", { recursive: true });
  expect(await reopened.exists("/repo/objects")).toBe(false);
});

it("fetches only main and reuses persisted objects after a new session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gitbin-fetch-"));
  const remotePath = join(directory, "remote.git");
  git(directory, ["init", "--bare", "--initial-branch=main", remotePath]);
  const source = join(directory, "source");
  git(directory, ["init", "--initial-branch=main", source]);
  git(source, ["config", "user.name", "test"]);
  git(source, ["config", "user.email", "test@example.com"]);
  await writeFile(join(source, "large.bin"), randomBytes(128 * 1024));
  git(source, ["add", "."]);
  git(source, ["commit", "-m", "main fixture"]);
  git(source, ["checkout", "--orphan", "unrelated"]);
  git(source, ["rm", "-rf", "."]);
  await writeFile(join(source, "unrelated.bin"), randomBytes(128 * 1024));
  git(source, ["add", "."]);
  git(source, ["commit", "-m", "unrelated fixture"]);
  const unrelatedBlob = git(source, ["rev-parse", "unrelated:unrelated.bin"]);
  git(source, ["remote", "add", "origin", remotePath]);
  git(source, ["push", "--all", "origin"]);
  const server = await gitServer(directory);
  try {
    const adapter = diskAdapter(directory);
    let downloaded = 0;
    let uploads = 0;
    const connection = {
      url: server.url,
      credentials: () => null,
      identity,
      network: {
        fetch: async (input: string | URL | Request, init?: RequestInit) => {
          if (String(input).endsWith("/git-upload-pack")) uploads++;
          const response = await fetch(input, init);
          downloaded += (await response.clone().arrayBuffer()).byteLength;
          return response;
        },
      },
    };
    const first = gitSession({ ...connection, fs: gitCache(adapter, "cache") });
    const initial = await first.fetch();
    expect(initial.revision).toBe(git(source, ["rev-parse", "main"]));
    expect(await initial.repo.objectStore.exists(unrelatedBlob)).toBe(false);
    expect(downloaded).toBeLessThan(12 * 1024);
    const largeBlob = git(source, ["rev-parse", "main:large.bin"]);
    await first.hydrate(initial.repo, [largeBlob]);
    expect(await initial.repo.objectStore.exists(largeBlob)).toBe(true);
    expect(
      (await initial.repo.refStore.listRefs("refs/remotes/origin")).map((ref) => ref.name),
    ).toEqual(["refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
    const initialBytes = downloaded;
    expect(initialBytes).toBeGreaterThan(128 * 1024);
    downloaded = 0;
    uploads = 0;
    const reopened = gitSession({ ...connection, fs: gitCache(adapter, "cache") });
    const reloaded = await reopened.fetch();
    expect(reloaded.revision).toBe(initial.revision);
    await reopened.hydrate(reloaded.repo, [largeBlob]);
    expect(uploads).toBeLessThanOrEqual(1);
    expect(downloaded).toBeLessThan(initialBytes / 100);
    const reloadedBytes = downloaded;
    git(source, ["checkout", "main"]);
    await writeFile(join(source, "new.md"), "Small incremental note.");
    git(source, ["add", "."]);
    git(source, ["commit", "-m", "increment"]);
    git(source, ["push", "origin", "main"]);
    downloaded = 0;
    expect((await reopened.fetch()).revision).toBe(git(source, ["rev-parse", "main"]));
    expect(downloaded).toBeLessThan(initialBytes / 20);
    await writeFile(
      join(directory, "transfer.json"),
      JSON.stringify({ initial: initialBytes, reloaded: reloadedBytes, incremental: downloaded }),
    );
    git(remotePath, ["symbolic-ref", "HEAD", "refs/heads/unrelated"]);
    git(remotePath, ["update-ref", "-d", "refs/heads/main"]);
    const missingMain = await reopened.fetch();
    expect(missingMain.revision).toBeNull();
    expect(missingMain.hasBranches).toBe(true);
    const remote = createGitRemote({ ...connection, fs: gitCache(adapter, "cache") });
    await expect(
      Effect.runPromise(remote.read({ root: "Personal", name: "Personal" })),
    ).rejects.toThrow("no main");
    git(remotePath, ["update-ref", "-d", "refs/heads/unrelated"]);
    const empty = await reopened.fetch();
    expect(empty.revision).toBeNull();
    expect(empty.hasBranches).toBe(false);
  } finally {
    await server.close();
  }
});
