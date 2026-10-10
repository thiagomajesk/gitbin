import { Effect } from "effect";
import type { GitRepo } from "just-git";
import {
  createCommit,
  flattenTree,
  readBlob,
  readCommit,
  updateTree,
  writeTree,
} from "just-git/repo";
import { attempt, io, SyncError } from "../core/errors";
import { metadataPath, readMetadata } from "../core/metadata";
import { parseStoredData } from "../core/storage-format";
import { createMigrationEngine } from "../maintenance/engine";
import { reinitializationRoots } from "../maintenance/reinitialize";
import type { ConsolidatedData, MigrationSnapshot } from "../maintenance/types";
import { readMaintenanceFiles } from "./maintenance-snapshot";
import { publicationState, sameConsolidation } from "./publication-decisions";
import { type Connection, gitSession } from "./session";

export interface ConsolidationPreview extends ConsolidatedData {
  readonly sourceRevision: string;
  readonly revision: string;
  readonly originalJournal: string | null;
}
const readEntries = (repo: GitRepo, revision: string) =>
  io("Cannot read the committed Git tree.", async () =>
    flattenTree(repo, (await readCommit(repo, revision)).tree),
  );
const readConsolidationHash = Effect.fn("maintenance.readHash")(function* (
  repo: GitRepo,
  revision: string,
  hydrate: (hashes: readonly string[]) => Promise<unknown>,
) {
  const entries = yield* readEntries(repo, revision);
  const hash = entries.find((entry) => entry.path === metadataPath)?.hash;
  if (!hash) return null;
  yield* io("Cannot fetch repository metadata.", () => hydrate([hash]));
  const bytes = yield* io("Cannot read repository metadata.", () => readBlob(repo, hash));
  return yield* attempt(
    "Cannot validate repository metadata.",
    () => readMetadata(parseStoredData(new TextDecoder().decode(bytes))).consolidationHash,
  );
});
export function consolidation(connection: Connection) {
  const session = gitSession(connection);
  const preview = Effect.fn("maintenance.preview")(function* (
    device: MigrationSnapshot | null = null,
    rebuildRoots?: readonly string[],
    report: (message: string) => void = () => {},
  ): Effect.fn.Return<ConsolidationPreview, SyncError> {
    report("Fetching repository…");
    const { repo, revision } = yield* io("Cannot fetch repository.", session.fetch);
    if (!revision)
      return yield* new SyncError({ message: "Consolidation requires an existing main branch." });
    const entries = yield* readEntries(repo, revision);
    if (entries.some((entry) => !["100644", "100755"].includes(entry.mode)))
      return yield* new SyncError({
        message:
          "Consolidation requires regular files. Symbolic links and submodules are not supported. No files were changed.",
      });
    report("Reading repository files…");
    const files = yield* readMaintenanceFiles(session, repo, entries, rebuildRoots !== undefined);
    const source: MigrationSnapshot = { kind: "repository", files };
    report(rebuildRoots ? "Rebuilding metadata…" : "Preparing repository…");
    const roots = rebuildRoots
      ? reinitializationRoots(
          entries.map((entry) => entry.path),
          rebuildRoots,
        )
      : undefined;
    const data = yield* createMigrationEngine().prepare(source, device, roots);
    report("Creating replacement revision…");
    const built = yield* io("Cannot create replacement revision.", async () => {
      const modes = new Map(entries.map((entry) => [entry.path, entry.mode]));
      const updates = [];
      for (const [path, bytes] of data.repository.files)
        updates.push({
          path,
          hash: await repo.objectStore.write("blob", bytes),
          mode: modes.get(path) ?? "100644",
        });
      const tree = await updateTree(repo, await writeTree(repo, []), updates);
      return createCommit(repo, {
        tree,
        parents: [],
        message: rebuildRoots
          ? "gitbin: reinitialize repository\n"
          : "gitbin: consolidate repository\n",
        author: connection.identity.author,
      });
    });
    return {
      sourceRevision: revision,
      revision: built,
      originalJournal: device ? new TextDecoder().decode(device.files.get("journal.json")) : null,
      ...data,
      vaults: rebuildRoots ? [...new Set([...rebuildRoots, ...data.vaults])].sort() : data.vaults,
    };
  });
  const statusAt = Effect.fn("maintenance.statusAt")(function* (
    current: Awaited<ReturnType<typeof session.fetch>>,
    expected: string,
    revision: string,
  ): Effect.fn.Return<"complete" | "pending" | "stale", SyncError> {
    const state = publicationState(current.revision, expected, revision);
    if (state !== "inspect" || !current.revision) return state === "inspect" ? "stale" : state;
    const hydrate = (hashes: readonly string[]) => session.hydrate(current.repo, hashes);
    const before = yield* readConsolidationHash(current.repo, revision, hydrate);
    const after = yield* readConsolidationHash(current.repo, current.revision, hydrate);
    return sameConsolidation(before, after) ? "complete" : "stale";
  });
  const status = Effect.fn("maintenance.status")(function* (expected: string, revision: string) {
    const current = yield* io("Cannot fetch repository state.", session.fetch);
    return yield* statusAt(current, expected, revision);
  });
  const apply = Effect.fn("maintenance.apply")(function* (
    expected: string,
    revision: string,
    report: (message: string) => void = () => {},
  ) {
    report("Checking repository revision…");
    const current = yield* io("Cannot fetch repository state.", session.fetch);
    if ((yield* statusAt(current, expected, revision)) === "complete") return;
    if (current.revision !== expected)
      return yield* new SyncError({
        message: "Repository changed since preview. Preview consolidation again.",
      });
    const root = yield* io("Cannot read replacement revision.", () =>
      readCommit(current.repo, revision),
    );
    if (root.parents.length !== 0)
      return yield* new SyncError({ message: "Consolidation must publish a root commit." });
    yield* io("Cannot update the local branch.", () =>
      current.repo.refStore.writeRef("refs/heads/main", revision),
    );
    report("Publishing repository…");
    yield* io("Cannot publish repository.", () => session.pushConsolidation(expected)).pipe(
      Effect.catch((error) =>
        Effect.gen(function* () {
          if ((yield* status(expected, revision)) !== "complete") return yield* error;
        }),
      ),
    );
    report("Verifying publication…");
    if ((yield* status(expected, revision)) !== "complete")
      return yield* new SyncError({
        message: "Cannot verify consolidation. Check repository state before retrying.",
      });
  });
  return { preview, apply, status };
}
