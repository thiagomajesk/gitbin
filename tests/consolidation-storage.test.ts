import { Effect } from "effect";
import type { App, DataAdapter } from "obsidian";
import { expect, it, vi } from "vitest";
import { objectReference } from "../src/core/inventory";
import { currentMetadata } from "../src/core/metadata";
import type { ConsolidationPreview } from "../src/git/consolidation";
import { createMigrationEngine } from "../src/maintenance/engine";
import { maintenanceStorage } from "../src/platform/consolidation";

vi.mock("obsidian", () => ({ Platform: { isDesktopApp: false } }));
function fixture() {
  const files = new Map<string, string>();
  const folders = new Set<string>();
  const binary = new Map<string, Uint8Array>();
  const writeBinary = vi.fn(async (path: string, bytes: ArrayBuffer) => {
    binary.set(path, new Uint8Array(bytes));
  });
  const readBinary = vi.fn(async (path: string) => binary.get(path)?.slice().buffer);
  let fail = false;
  const adapter = {
    exists: async (path: string) => files.has(path) || folders.has(path) || binary.has(path),
    writeBinary,
    readBinary,
    mkdir: async (path: string) => {
      folders.add(path);
    },
    read: async (path: string) => {
      const value = files.get(path);
      if (value === undefined) throw Error("Missing file");
      return value;
    },
    write: async (path: string, value: string) => {
      if (fail && path.endsWith("/journal.json")) throw Error("Disk failure");
      files.set(path, value);
    },
    remove: async (path: string) => {
      files.delete(path);
    },
    rename: async (from: string, to: string) => {
      if (files.has(to)) throw Error("Destination file already exists!");
      if (fail && to.endsWith("/journal.json")) throw Error("Disk failure");
      files.set(to, files.get(from) ?? "");
      files.delete(from);
    },
  } as unknown as DataAdapter;
  const app = { vault: { adapter } } as App;
  const directory = ".obsidian/plugins/gitbin/local/test";
  return {
    files,
    binary,
    writeBinary,
    readBinary,
    directory,
    storage: () => maintenanceStorage(app, directory),
    fail: (value: boolean) => {
      fail = value;
    },
  };
}
it("loads referenced recovery and history objects once without reading unrelated cache files", async () => {
  const f = fixture();
  const bytes = new Uint8Array([1, 2, 3]);
  const content = objectReference(bytes);
  f.binary.set(f.directory + "/objects/" + content.hash, bytes);
  f.binary.set(f.directory + "/objects/" + "a".repeat(40), new Uint8Array([99]));
  f.files.set(
    f.directory + "/journal.json",
    JSON.stringify({
      metadata: currentMetadata(),
      vaultRoot: "personal",
      revision: null,
      entries: [],
      intents: [
        {
          id: "interrupted",
          path: "Note.md",
          before: content,
          after: content,
          baselineState: null,
          available: true,
        },
      ],
      history: {
        checkpoint: [
          { id: "history", path: "Note.md", text: null, binary: true, hash: content.hash, content },
        ],
        entries: [],
      },
    }),
  );
  const snapshot = await Effect.runPromise(f.storage().loadDevice());
  expect(f.readBinary.mock.calls.map(([path]) => path)).toEqual([
    f.directory + "/objects/" + content.hash,
  ]);
  expect(snapshot).not.toBeNull();
  expect([...(snapshot?.files.keys() ?? [])]).toEqual(["journal.json", "objects/" + content.hash]);
  expect(f.binary.size).toBe(2);
});
it("reuses valid cached objects and repairs a corrupt cached copy before staging", async () => {
  const f = fixture();
  const p = await preview(f);
  const bytes = new Uint8Array([1, 2, 3]);
  const path = "objects/" + objectReference(bytes).hash;
  if (!p.device) throw new Error("Missing device");
  const device = { ...p.device, files: new Map(p.device.files).set(path, bytes) };
  f.binary.set(f.directory + "/" + path, bytes);
  await Effect.runPromise(f.storage().stage({ ...p, device }));
  expect(f.writeBinary).not.toHaveBeenCalled();
  await Effect.runPromise(f.storage().discardStale());
  f.binary.set(f.directory + "/" + path, new Uint8Array([0]));
  await Effect.runPromise(f.storage().stage({ ...p, device }));
  expect(f.writeBinary).toHaveBeenCalledTimes(1);
  expect(f.binary.get(f.directory + "/" + path)).toEqual(bytes);
});
async function preview(f: ReturnType<typeof fixture>): Promise<ConsolidationPreview> {
  const original = JSON.stringify({ vaultRoot: "personal", files: [], intents: [] });
  f.files.set(f.directory + "/journal.json", original);
  const data = await Effect.runPromise(
    createMigrationEngine().prepare(
      { kind: "repository", files: new Map() },
      await Effect.runPromise(f.storage().loadDevice()),
    ),
  );
  return {
    ...data,
    sourceRevision: "a".repeat(40),
    revision: "b".repeat(40),
    originalJournal: original,
  };
}
it("stages without replacing the original journal and resumes an interrupted installation", async () => {
  const f = fixture();
  const p = await preview(f);
  await Effect.runPromise(f.storage().stage(p));
  expect(f.files.get(f.directory + "/journal.json")).toBe(p.originalJournal);
  expect(await Effect.runPromise(f.storage().pending())).not.toBeNull();
  f.fail(true);
  await expect(Effect.runPromise(f.storage().install())).rejects.toThrow("Disk failure");
  expect(await Effect.runPromise(f.storage().pending())).not.toBeNull();
  expect(f.files.has(f.directory + "/journal.json")).toBe(false);
  expect(f.files.get(f.directory + "/journal.before-consolidation.json")).toBe(p.originalJournal);
  f.fail(false);
  await Effect.runPromise(f.storage().install());
  expect(await Effect.runPromise(f.storage().pending())).toBeNull();
  expect(JSON.parse(f.files.get(f.directory + "/journal.json") ?? "{}")).toMatchObject({
    metadata: { consolidationHash: null },
  });
  expect(f.files.get(f.directory + "/journal.before-consolidation.json")).toBe(p.originalJournal);
});
it("refuses changed local journals and preserves stale checkpoints separately", async () => {
  const f = fixture();
  const p = await preview(f);
  f.files.set(f.directory + "/journal.json", "changed");
  await expect(Effect.runPromise(f.storage().stage(p))).rejects.toThrow("Local journal changed");
  f.files.set(f.directory + "/journal.json", p.originalJournal ?? "");
  await Effect.runPromise(f.storage().stage(p));
  await Effect.runPromise(f.storage().discardStale());
  expect(await Effect.runPromise(f.storage().pending())).toBeNull();
  expect([...f.files.keys()].some((path) => path.includes("consolidation-stale-"))).toBe(true);
  expect(f.files.get(f.directory + "/journal.json")).toBe(p.originalJournal);
});
