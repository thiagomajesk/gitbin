import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import type { GitContext } from "just-git";
import { vi } from "vitest";
import { readMaintenanceFiles } from "../src/git/maintenance-snapshot";
import type { gitSession } from "../src/git/session";

const { objects } = vi.hoisted(() => ({ objects: new Map<string, Uint8Array>() }));
vi.mock("just-git/repo", () => ({
  readBlob: async (_repo: unknown, hash: string) => objects.get(hash),
}));
it.effect("does not download discarded metadata during reinitialization", () =>
  Effect.gen(function* () {
    objects.set("committed", new Uint8Array([1, 2]));
    const hydrate = vi.fn(async () => {});
    const session = { hydrate } as unknown as ReturnType<typeof gitSession>;
    const files = yield* readMaintenanceFiles(
      session,
      remoteContext(),
      [
        { path: ".gitbin/vaults/vault/inventory.json", hash: "unavailable" },
        { path: ".gitbin/metadata.json", hash: "unavailable" },
        { path: "vault/file", hash: "committed" },
      ],
      true,
    );
    expect(hydrate).toHaveBeenCalledTimes(1);
    expect([...files.keys()]).toEqual(["vault/file"]);
  }),
);
it.effect("allows maintenance totals and metadata beyond the former hidden caps", () =>
  Effect.gen(function* () {
    const entries = Array.from({ length: 5 }, (_, i) => ({
      path: "vault/file" + i,
      hash: String(i),
    }));
    for (const entry of entries) objects.set(entry.hash, new Uint8Array(4));
    entries.push({ path: ".gitbin/metadata.json", hash: "metadata" });
    objects.set("metadata", new Uint8Array(4 * 1024 * 1024 + 1));
    const session = { hydrate: async () => {} } as unknown as ReturnType<typeof gitSession>;
    const files = yield* readMaintenanceFiles(session, remoteContext(), entries);
    expect(files.size).toBe(6);
    expect(files.get(".gitbin/metadata.json")?.length).toBe(4 * 1024 * 1024 + 1);
  }),
);
function remoteContext(cached = false): GitContext {
  return { objectStore: { exists: async () => cached } } as unknown as GitContext;
}
it.effect("reuses existing Git objects without hydration", () =>
  Effect.gen(function* () {
    objects.set("cached-large", new Uint8Array(50));
    const hydrate = vi.fn(async () => {});
    const session = { hydrate } as unknown as ReturnType<typeof gitSession>;
    const files = yield* readMaintenanceFiles(session, remoteContext(true), [
      { path: "vault/file", hash: "cached-large" },
    ]);
    expect(files.get("vault/file")?.length).toBe(50);
    expect(hydrate).not.toHaveBeenCalled();
  }),
);
