import { Effect } from "effect";
import type { GitRepo } from "just-git";
import { buildCommit, flattenTree, readBlob, readCommit } from "just-git/repo";
import { attempt, io, SyncError } from "../core/errors";
import { metadataPath, readMetadata } from "../core/metadata";
import { parseStoredData } from "../core/storage-format";
import { createMigrationEngine } from "../maintenance/engine";
import { reinitializeRepository } from "../maintenance/reinitialize";
import type { ConsolidatedData, MigrationSnapshot } from "../maintenance/types";
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
    if (entries.some((entry) => entry.mode !== "100644"))
      return yield* new SyncError({
        message:
          "Consolidation currently requires regular non-executable files. No files were changed.",
      });
    report("Reading repository files…");
    yield* io("Cannot fetch repository files.", () =>
      session.hydrate(repo, [...new Set(entries.map((entry) => entry.hash))]),
    );
    const files = new Map<string, Uint8Array>();
    for (const entry of entries)
      files.set(
        entry.path,
        yield* io("Cannot read repository file.", () => readBlob(repo, entry.hash)),
      );
    const source: MigrationSnapshot = { kind: "repository", files };
    report(rebuildRoots ? "Rebuilding metadata…" : "Preparing repository…");
    const prepared = rebuildRoots
      ? yield* attempt("Cannot rebuild repository metadata.", () =>
          reinitializeRepository(source, rebuildRoots),
        )
      : source;
    const data = yield* createMigrationEngine().prepare(prepared, device);
    report("Creating replacement revision…");
    const built = yield* io("Cannot create replacement revision.", () =>
      buildCommit(repo, {
        files: Object.fromEntries(data.repository.files),
        message: rebuildRoots
          ? "gitbin: reinitialize repository\n"
          : "gitbin: consolidate repository\n",
        author: connection.identity.author,
      }),
    );
    return {
      sourceRevision: revision,
      revision: built.hash,
      originalJournal: device ? new TextDecoder().decode(device.files.get("journal.json")) : null,
      ...data,
      vaults: rebuildRoots ? [...new Set([...rebuildRoots, ...data.vaults])].sort() : data.vaults,
    };
  });
  const status = Effect.fn("maintenance.status")(function* (
    expected: string,
    revision: string,
  ): Effect.fn.Return<"complete" | "pending" | "stale", SyncError> {
    const current = yield* io("Cannot fetch repository state.", session.fetch);
    if (current.revision === revision) return "complete";
    if (current.revision === expected) return "pending";
    if (!current.revision) return "stale";
    const hydrate = (hashes: readonly string[]) => session.hydrate(current.repo, hashes);
    const before = yield* readConsolidationHash(current.repo, revision, hydrate);
    const after = yield* readConsolidationHash(current.repo, current.revision, hydrate);
    return before && before === after ? "complete" : "stale";
  });
  const apply = Effect.fn("maintenance.apply")(function* (
    expected: string,
    revision: string,
    report: (message: string) => void = () => {},
  ) {
    report("Checking repository revision…");
    const current = yield* io("Cannot fetch repository state.", session.fetch);
    if ((yield* status(expected, revision)) === "complete") return;
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
