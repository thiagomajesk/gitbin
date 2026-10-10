import { Effect } from "effect";
import type { App, DataAdapter } from "obsidian";
import { expect, it, vi } from "vitest";
import { blobId } from "../src/core/blobs";
import { binaryContent, contentBytes } from "../src/core/content";
import { ObsidianVault } from "../src/platform/vault";

vi.mock("obsidian", () => ({ Platform: { isDesktopApp: false } }));

it("persists byte-exact binary objects once, validates reloads, and rejects corrupt objects", async () => {
  const objects = new Map<string, ArrayBuffer>();
  const folders = new Set<string>();
  const writeBinary = vi.fn(async (path: string, bytes: ArrayBuffer) => {
    objects.set(path, bytes.slice(0));
  });
  const adapter = {
    exists: async (path: string) => objects.has(path) || folders.has(path),
    mkdir: async (path: string) => {
      folders.add(path);
    },
    writeBinary,
    readBinary: async (path: string) => {
      const bytes = objects.get(path);
      if (!bytes) throw new Error("Missing blob");
      return bytes.slice(0);
    },
  } as unknown as DataAdapter;
  const app = { vault: { adapter } } as App;
  const directory = ".obsidian/plugins/gitbin/local/test";
  const local = new ObsidianVault(app, directory);
  const content = binaryContent(new Uint8Array([0, 255, 128, 3]));
  const id = blobId(content);
  await Effect.runPromise(local.saveBlobs(new Map([[id, content]])));
  await Effect.runPromise(local.saveBlobs(new Map([[id, content]])));
  expect(writeBinary).toHaveBeenCalledTimes(1);
  const reopened = new ObsidianVault(app, directory);
  expect((await Effect.runPromise(reopened.loadBlobs([id]))).get(id)).toEqual(content);
  expect(objects.get(directory + "/blobs/" + id)).toEqual(contentBytes(content).buffer);
  await expect(Effect.runPromise(local.loadBlobs(["../escape"]))).rejects.toThrow();
  objects.set(directory + "/blobs/" + id, new Uint8Array([3]).buffer);
  await expect(Effect.runPromise(reopened.loadBlobs([id]))).rejects.toThrow();
  await Effect.runPromise(local.saveBlobs(new Map([[id, content]])));
  expect((await Effect.runPromise(reopened.loadBlobs([id]))).get(id)).toEqual(content);
});
