import { reinitializeRepository } from "../maintenance/reinitialize";
import type { GitRepo } from "just-git";
import { Effect } from "effect";
import { readCommit, flattenTree, readBlob, buildCommit } from "just-git/repo";
import { createMigrationEngine } from "../maintenance/engine";
import { metadataPath, readMetadata } from "../core/metadata";
import { parseStoredData } from "../core/storage-format";
import type { MigrationSnapshot } from "../maintenance/types";
import type { Connection } from "./session";
import { gitSession } from "./session";

export function consolidation(connection: Connection) {
  const session = gitSession(connection);
  const preview = async (
    device: MigrationSnapshot | null = null,
    rebuildRoots?: readonly string[],
    report: (message: string) => void = () => {},
  ) => {
    report("Fetching repository…");
    const { repo, revision } = await session.fetch();
    if (!revision) throw new Error("Consolidation requires an existing main branch.");
    const entries = await flattenTree(repo, (await readCommit(repo, revision)).tree);
    if (entries.some((entry) => entry.mode !== "100644"))
      throw new Error(
        "Consolidation currently requires regular non-executable files. No files were changed.",
      );
    report("Reading repository files…");
    await session.hydrate(repo, [...new Set(entries.map((entry) => entry.hash))]);
    const files = new Map<string, Uint8Array>();
    for (const entry of entries) files.set(entry.path, await readBlob(repo, entry.hash));
    const source: MigrationSnapshot = { kind: "repository", files };
    report(rebuildRoots ? "Rebuilding metadata…" : "Preparing repository…");
    const data = await Effect.runPromise(
      createMigrationEngine().prepare(
        rebuildRoots ? reinitializeRepository(source, rebuildRoots) : source,
        device,
      ),
    );
    report("Creating replacement revision…");
    const built = await buildCommit(repo, {
      files: Object.fromEntries(data.repository.files),
      message: rebuildRoots
        ? "gitbin: reinitialize repository\n"
        : "gitbin: consolidate repository\n",
      author: connection.identity.author,
    });
    return {
      sourceRevision: revision,
      revision: built.hash,
      originalJournal: device ? new TextDecoder().decode(device.files.get("journal.json")) : null,
      ...data,
      vaults: rebuildRoots ? [...new Set([...rebuildRoots, ...data.vaults])].sort() : data.vaults,
    };
  };
  const status = async (
    expected: string,
    revision: string,
  ): Promise<"complete" | "pending" | "stale"> => {
    const current = await session.fetch();
    if (current.revision === revision) return "complete";
    if (current.revision === expected) return "pending";
    if (!current.revision) return "stale";
    const hydrate = (hashes: readonly string[]) => session.hydrate(current.repo, hashes);
    const before = await readConsolidationHash(current.repo, revision, hydrate);
    const after = await readConsolidationHash(current.repo, current.revision, hydrate);
    return before && before === after ? "complete" : "stale";
  };
  const apply = async (
    expected: string,
    revision: string,
    report: (message: string) => void = () => {},
  ) => {
    report("Checking repository revision…");
    const current = await session.fetch();
    if ((await status(expected, revision)) === "complete") return;
    if (current.revision !== expected)
      throw new Error("Repository changed since preview. Preview consolidation again.");
    const root = await readCommit(current.repo, revision);
    if (root.parents.length !== 0) throw new Error("Consolidation must publish a root commit.");
    await current.repo.refStore.writeRef("refs/heads/main", revision);
    try {
      report("Publishing repository…");
      await session.pushConsolidation(expected);
    } catch (error) {
      if ((await status(expected, revision)) !== "complete") throw error;
    }
    report("Verifying publication…");
    if ((await status(expected, revision)) !== "complete")
      throw new Error("Cannot verify consolidation. Check repository state before retrying.");
  };
  return { preview, apply, status };
}
export type ConsolidationPreview = Awaited<ReturnType<ReturnType<typeof consolidation>["preview"]>>;

async function readConsolidationHash(
  repo: GitRepo,
  revision: string,
  hydrate: (hashes: readonly string[]) => Promise<unknown>,
): Promise<string | null> {
  const entries = await flattenTree(repo, (await readCommit(repo, revision)).tree);
  const hash = entries.find((entry) => entry.path === metadataPath)?.hash;
  if (!hash) return null;
  await hydrate([hash]);
  return readMetadata(parseStoredData(new TextDecoder().decode(await readBlob(repo, hash))))
    .consolidationHash;
}
