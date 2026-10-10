import { Effect } from "effect";
import type { App, TFile } from "obsidian";
import { expect, it, vi } from "vitest";
import { binaryContent, textContent } from "../src/core/content";
import { ObsidianVault } from "../src/platform/vault";

vi.mock("obsidian", () => ({ Platform: { isDesktopApp: false } }));
const run = Effect.runPromise;
function vault() {
  const files = new Map<string, Uint8Array>();
  const folders = new Set<string>();
  const file = (path: string) => ({ path }) as TFile;
  const host = {
    vault: {
      adapter: {},
      getFiles: () => [...files.keys()].map(file),
      getFileByPath: (path: string) => (files.has(path) ? file(path) : null),
      getFolderByPath: () => null,
      getAbstractFileByPath: (path: string) => (folders.has(path) ? { path } : null),
      createFolder: async (path: string) => {
        folders.add(path);
      },
      readBinary: async (entry: TFile) => new Uint8Array(files.get(entry.path) ?? []).buffer,
      createBinary: async (path: string, data: ArrayBuffer) => {
        files.set(path, new Uint8Array(data));
      },
      modifyBinary: vi.fn(async (entry: TFile, data: ArrayBuffer) => {
        files.set(entry.path, new Uint8Array(data));
      }),
      process: async (entry: TFile, update: (text: string) => string) => {
        const next = update(new TextDecoder().decode(files.get(entry.path)));
        files.set(entry.path, new TextEncoder().encode(next));
      },
    },
    fileManager: {
      trashFile: async (entry: TFile) => {
        files.delete(entry.path);
      },
    },
  };
  return {
    files,
    folders,
    host,
    local: new ObsidianVault(host as unknown as App, ".obsidian/plugins/gitbin/local/test"),
  };
}

it("scans all content files byte-exactly while keeping configuration local", async () => {
  const test = vault();
  const bytes = new Uint8Array([0, 255, 13, 10, 128]);
  test.files.set("Images/photo.png", bytes);
  test.files.set("Guide.txt", new TextEncoder().encode("Plain text"));
  test.files.set("Board.canvas", new TextEncoder().encode('{"nodes":[]}'));
  test.files.set(".obsidian/app.json", new TextEncoder().encode("private settings"));
  test.files.set(".obsidian/plugins/gitbin/local/test/journal.json", bytes);
  const content = await run(test.local.scan());
  expect([...content.keys()]).toEqual(["Images/photo.png", "Guide.txt", "Board.canvas"]);
  expect(content.get("Images/photo.png")).toEqual(binaryContent(bytes));
  expect(content.get("Guide.txt")).toEqual(textContent("Plain text"));
  expect(content.get("Board.canvas")?.type).toBe("binary");
});

it("creates only needed folders and applies binary create, replace and deletion", async () => {
  const test = vault();
  const initial = binaryContent(new Uint8Array([0, 1, 255]));
  const next = binaryContent(new Uint8Array([255, 128, 0, 42]));
  await run(test.local.write("Assets/manual.pdf", null, initial));
  expect([...test.folders]).toEqual(["Assets"]);
  expect(await run(test.local.read("Assets/manual.pdf"))).toEqual(initial);
  await run(test.local.write("Assets/manual.pdf", initial, next));
  expect(await run(test.local.read("Assets/manual.pdf"))).toEqual(next);
  await run(test.local.write("Assets/manual.pdf", next, next));
  expect(test.host.vault.modifyBinary).toHaveBeenCalledTimes(1);
  await run(test.local.write("Assets/manual.pdf", next, null));
  expect(test.files.size).toBe(0);
});

it("refuses binary replacement when the saved file differs from its observed baseline", async () => {
  const test = vault();
  const changed = new Uint8Array([0, 255, 5]);
  test.files.set("clip.wav", changed);
  await expect(
    run(
      test.local.write(
        "clip.wav",
        binaryContent(new Uint8Array([0, 1])),
        binaryContent(new Uint8Array([0, 2])),
      ),
    ),
  ).rejects.toThrow("content was preserved");
  expect(test.files.get("clip.wav")).toEqual(changed);
  expect(test.host.vault.modifyBinary).not.toHaveBeenCalled();
});

it("keeps text writes atomic and refuses writes into device configuration", async () => {
  const test = vault();
  test.files.set("Guide.md", new TextEncoder().encode("Current text"));
  await expect(
    run(test.local.write("Guide.md", textContent("Old text"), textContent("Remote text"))),
  ).rejects.toThrow();
  expect(await run(test.local.read("Guide.md"))).toEqual(textContent("Current text"));
  await expect(
    run(test.local.write(".obsidian/app.json", null, textContent("bad"))),
  ).rejects.toThrow();
});
