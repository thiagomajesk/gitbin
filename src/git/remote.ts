import { inspectVaults } from "./status";
import { Effect } from "effect";
import { SyncError, io, attempt } from "../core/errors";
import type { GitRemote, Publication, RemoteSnapshot } from "../core/ports";
import { type Registration, checkRoot } from "../core/protocol";
import { discoverVaults } from "./vaults";
import { type Connection, gitSession } from "./session";
import { candidate, readEntries, readFiles } from "./objects";
export function checkRemote(remote: string): void {
  const url = new URL(remote);
  const local =
    url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !local) ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    /\s/.test(remote)
  )
    throw new Error(
      "Use the repository's HTTPS URL without a token. SSH and local paths are not supported.",
    );
}
export function createGitRemote(connection: Connection) {
  checkRemote(connection.url);
  const session = gitSession(connection);
  const read = Effect.fn("git.read")(function* (
    vault: Registration,
  ): Effect.fn.Return<RemoteSnapshot, SyncError> {
    if (!checkRoot(vault.root) || vault.root.includes("/"))
      return yield* new SyncError({
        message: "Choose a portable repository folder for this vault.",
      });
    const fetched = yield* io(
      "Cannot reach the repository. Check its HTTPS URL and authenticate with the server.",
      session.fetch,
    );
    if (!fetched.revision) {
      if (fetched.hasBranches)
        return yield* new SyncError({
          message: "This repository has branches but no main. Create main before connecting.",
        });
      return { revision: null, vaults: [], states: new Map(), files: new Map() };
    }
    const entries = yield* io("Cannot read the committed Git tree.", () =>
      readEntries(fetched.repo, fetched.revision ?? "", vault),
    );
    const vaults = yield* attempt("Cannot read Gitbin storage layout.", () =>
      discoverVaults(entries),
    );
    const content = yield* io("Cannot read saved files.", () =>
      readFiles(fetched.repo, entries, vault, (hashes) => session.hydrate(fetched.repo, hashes)),
    );
    return { revision: fetched.revision, vaults, ...content };
  });
  const publish = Effect.fn("git.publish")(function* (
    base: RemoteSnapshot,
    publication: Publication,
  ): Effect.fn.Return<{ published: boolean; revision: string | null }, SyncError> {
    const repo = yield* io("Cannot open the private Git cache.", session.repo);
    const hash = yield* io("Cannot create the next sync commit.", () =>
      candidate(repo, base, publication, connection.identity),
    );
    return yield* io(
      "Cannot upload files. Check that your authentication allows Git write access.",
      async () => {
        await repo.refStore.writeRef("refs/heads/main", hash);
        try {
          await session.run(["push", "origin", "refs/heads/main:refs/heads/main"]);
          return { published: true, revision: hash };
        } catch (error) {
          const current = (await session.fetch()).revision;
          if (current === hash) return { published: true, revision: hash };
          if (current !== base.revision) return { published: false, revision: null };
          throw error;
        }
      },
    );
  });
  const inspect = Effect.fn("git.inspect")(function* (
    vault: Registration,
    checkpoint: string | null,
  ) {
    const snapshot = yield* read(vault);
    const repo = yield* io("Cannot inspect Git state.", session.repo);
    return yield* io("Cannot inspect vault changes.", () =>
      inspectVaults(repo, snapshot, vault.root, checkpoint),
    );
  });
  return { read, publish, inspect } satisfies GitRemote & { inspect: typeof inspect };
}
