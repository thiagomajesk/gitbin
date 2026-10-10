import { Effect } from "effect";
import type { GitRepo } from "just-git";
import { createCommit, readCommit, updateTree, writeTree } from "just-git/repo";
import { reportProgress } from "../core/activity";
import { attempt, io } from "../core/errors";
import {
  type InventoryFile,
  inventoryPath,
  objectReference,
  validateInventory,
} from "../core/inventory";
import { currentMetadata, metadataPath } from "../core/metadata";
import { hiddenPath } from "../core/path-rules";
import { type Registration, validateVaults } from "../core/protocol";
import type { InventorySnapshot, SelectiveRemote } from "../core/selective-ports";
import { contentCatalog } from "./catalog";
import { readEntries } from "./objects";
import { type Connection, gitSession } from "./session";

async function targets(
  repo: GitRepo,
  base: InventorySnapshot,
  vault: Registration,
  files: readonly InventoryFile[],
): Promise<Map<string, string>> {
  const entries = new Map<string, string>();
  for (const file of files) {
    entries.set(file.statePath, file.state.hash);
    if (file.path !== null) entries.set(`${vault.root}/${file.path}`, file.content.hash);
    else
      entries.set(`.gitbin/vaults/${vault.root}/retained/${file.content.hash}`, file.content.hash);
  }
  const inventory = { files: [...files].sort((a, b) => a.id.localeCompare(b.id)) };
  entries.set(
    inventoryPath(vault.root),
    await repo.objectStore.write("blob", new TextEncoder().encode(JSON.stringify(inventory))),
  );
  entries.set(
    metadataPath,
    await repo.objectStore.write(
      "blob",
      new TextEncoder().encode(JSON.stringify(currentMetadata(base.consolidationHash))),
    ),
  );
  return entries;
}

async function build(
  repo: GitRepo,
  base: InventorySnapshot,
  vault: Registration,
  files: readonly InventoryFile[],
  connection: Connection,
): Promise<string | null> {
  const old = base.revision
    ? await readEntries(repo, base.revision, vault)
    : new Map<string, string>();
  const next = await targets(repo, base, vault, files);
  const changes: { path: string; hash: string | null; mode: string }[] = [...next].map(
    ([path, hash]) => ({
      path,
      hash,
      mode: "100644",
    }),
  );
  for (const path of old.keys()) {
    if (managedPath(path, vault.root) && !next.has(path))
      changes.push({ path, hash: null, mode: "100644" });
  }
  const before = base.revision
    ? (await readCommit(repo, base.revision)).tree
    : await writeTree(repo, []);
  const tree = await updateTree(repo, before, changes);
  if (tree === before) return base.revision;
  return createCommit(repo, {
    tree,
    parents: base.revision ? [base.revision] : [],
    author: connection.identity.author,
    committer: { name: "Gitbin", email: `gitbin@${connection.identity.device}` },
    message: `gitbin: sync \`${vault.name}\` from \`${connection.identity.device}\`\n`,
    branch: "main",
  });
}

function managedPath(path: string, root: string): boolean {
  return (
    path.startsWith(`.gitbin/vaults/${root}/`) ||
    (path.startsWith(root + "/") && !hiddenPath(path.slice(root.length + 1)))
  );
}

export function createSelectiveRemote(connection: Connection): SelectiveRemote {
  const session = gitSession(connection);
  const catalog = contentCatalog(session);
  const put = Effect.fn("selective.put")(function* (bytes: Uint8Array) {
    const repo = yield* io("Cannot open the transport cache.", session.repo);
    yield* io("Cannot stage a Git object.", () => repo.objectStore.write("blob", bytes));
    return objectReference(bytes);
  });
  const publish = Effect.fn("selective.publish")(function* (
    base: InventorySnapshot,
    vault: Registration,
    files: readonly InventoryFile[],
  ) {
    yield* attempt("Cannot publish vault inventory.", () => {
      validateVaults([...base.vaults.filter((value) => value.root !== vault.root), vault]);
      validateInventory({ files }, vault.root);
    });
    const fetched = yield* io("Cannot refresh repository before publication.", session.fetch);
    if (fetched.revision !== base.revision) return { published: false, revision: fetched.revision };
    const revision = yield* io("Cannot build selective publication.", () =>
      build(fetched.repo, base, vault, files, connection),
    );
    if (!revision || revision === base.revision) return { published: true, revision };
    yield* reportProgress("Uploading local changes…");
    return yield* io("Cannot upload local changes. They remain saved on this device.", async () => {
      try {
        await session.run(["push", "origin", "refs/heads/main:refs/heads/main"]);
        return { published: true, revision };
      } catch (cause) {
        const current = (await session.fetch()).revision;
        if (current === revision) return { published: true, revision };
        if (current !== base.revision) return { published: false, revision: current };
        throw cause;
      }
    });
  });
  return {
    read: catalog.read,
    object: catalog.object,
    put,
    publish,
    release: (hash) => io("Cannot release downloaded Git cache data.", () => session.release(hash)),
    clear: () => io("Cannot rotate the Git transport cache.", session.clear),
  };
}
