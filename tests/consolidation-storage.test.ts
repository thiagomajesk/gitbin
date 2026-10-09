import type { App, DataAdapter } from "obsidian";
import { expect, it, vi } from "vitest";
import { Effect } from "effect";
import { maintenanceStorage } from "../src/platform/consolidation";
import { createMigrationEngine } from "../src/maintenance/engine";
import type { ConsolidationPreview } from "../src/git/consolidation";
vi.mock("obsidian", () => ({ Platform: { isDesktopApp: false } }));
function fixture() {
  const files = new Map<string, string>();
  const folders = new Set<string>();
  let fail = false;
  const adapter = {
    exists: async (path: string) => files.has(path) || folders.has(path),
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
    directory,
    storage: () => maintenanceStorage(app, directory),
    fail: (value: boolean) => {
      fail = value;
    },
  };
}
async function preview(f: ReturnType<typeof fixture>): Promise<ConsolidationPreview> {
  const original = JSON.stringify({ vaultRoot: "personal", files: [], intents: [] });
  f.files.set(f.directory + "/journal.json", original);
  const data = await Effect.runPromise(
    createMigrationEngine().prepare(
      { kind: "repository", files: new Map() },
      await f.storage().loadDevice(),
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
  await f.storage().stage(p);
  expect(f.files.get(f.directory + "/journal.json")).toBe(p.originalJournal);
  expect(await f.storage().pending()).not.toBeNull();
  f.fail(true);
  await expect(f.storage().install()).rejects.toThrow("Disk failure");
  expect(await f.storage().pending()).not.toBeNull();
  expect(f.files.has(f.directory + "/journal.json")).toBe(false);
  expect(f.files.get(f.directory + "/journal.before-consolidation.json")).toBe(p.originalJournal);
  f.fail(false);
  await f.storage().install();
  expect(await f.storage().pending()).toBeNull();
  expect(
    JSON.parse(f.files.get(f.directory + "/journal.json") ?? "{}").metadata.consolidationHash,
  ).toBeNull();
  expect(f.files.get(f.directory + "/journal.before-consolidation.json")).toBe(p.originalJournal);
});
it("refuses changed local journals and preserves stale checkpoints separately", async () => {
  const f = fixture();
  const p = await preview(f);
  f.files.set(f.directory + "/journal.json", "changed");
  await expect(f.storage().stage(p)).rejects.toThrow("Local journal changed");
  f.files.set(f.directory + "/journal.json", p.originalJournal ?? "");
  await f.storage().stage(p);
  await f.storage().discardStale();
  expect(await f.storage().pending()).toBeNull();
  expect([...f.files.keys()].some((path) => path.includes("consolidation-stale-"))).toBe(true);
  expect(f.files.get(f.directory + "/journal.json")).toBe(p.originalJournal);
});
