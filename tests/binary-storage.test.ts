import { Effect } from "effect";
import type { App, DataAdapter } from "obsidian";
import { expect, it, vi } from "vitest";
import { objectReference } from "../src/core/inventory";
import { SelectiveObsidianVault } from "../src/platform/selective-vault";

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
    stat: async (path: string) =>
      objects.has(path) ? { size: objects.get(path)?.byteLength ?? 0 } : null,
    readBinary: async (path: string) => {
      const bytes = objects.get(path);
      if (!bytes) throw new Error("Missing blob");
      return bytes.slice(0);
    },
  } as unknown as DataAdapter;
  const app = { vault: { adapter } } as App;
  const directory = ".obsidian/plugins/gitbin/local/test";
  const local = new SelectiveObsidianVault(
    app,
    directory,
    () => false,
    () => {},
    () => {},
  );
  const content = new Uint8Array([0, 255, 128, 3]);
  const reference = objectReference(content);
  const id = reference.hash;
  await Effect.runPromise(local.put(content));
  await Effect.runPromise(local.put(content));
  expect(writeBinary).toHaveBeenCalledTimes(1);
  const reopened = new SelectiveObsidianVault(
    app,
    directory,
    () => false,
    () => {},
    () => {},
  );
  expect(await Effect.runPromise(reopened.object(reference, 100))).toEqual(content);
  expect(objects.get(directory + "/objects/" + id)).toEqual(content.buffer);
  await expect(
    Effect.runPromise(local.object({ hash: "../escape", bytes: 0 }, 100)),
  ).rejects.toThrow();
  objects.set(directory + "/objects/" + id, new Uint8Array([3]).buffer);
  await expect(Effect.runPromise(reopened.object(reference, 100))).rejects.toThrow();
  await expect(Effect.runPromise(local.put(content))).rejects.toThrow();
});
