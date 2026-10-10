import { Effect } from "effect";
import { readBlob } from "just-git/repo";
import { attempt, io, SyncError } from "../core/errors";
import {
  decodeInventory,
  type Inventory,
  inventoryPath,
  type ObjectReference,
  verifyObject,
} from "../core/inventory";
import { metadataPath, requireCurrentMetadata } from "../core/metadata";
import { hiddenPath } from "../core/path-rules";
import { type Registration, validateVaults } from "../core/protocol";
import { readEntries } from "./objects";
import type { gitSession } from "./session";
import { discoverVaults } from "./vaults";

interface Catalog {
  readonly revision: string | null;
  readonly consolidationHash: string | null;
  readonly vaults: readonly Registration[];
  readonly inventory: Inventory;
}

function checkTree(
  inventory: Inventory,
  entries: ReadonlyMap<string, string>,
  vault: Registration,
): void {
  const visible = new Set<string>();
  const states = new Set<string>();
  for (const file of inventory.files) {
    states.add(file.statePath);
    if (entries.get(file.statePath) !== file.state.hash)
      throw new Error("Committed state differs from the inventory. Reinitialize the repository.");
    if (file.path === null) continue;
    const path = `${vault.root}/${file.path}`;
    if (entries.get(path) !== file.content.hash)
      throw new Error("Committed file differs from the inventory. Reinitialize the repository.");
    visible.add(path);
  }
  checkUntracked(entries, vault.root, visible, states);
}

function checkUntracked(
  entries: ReadonlyMap<string, string>,
  root: string,
  visible: ReadonlySet<string>,
  states: ReadonlySet<string>,
): void {
  for (const path of entries.keys()) {
    if (
      path.startsWith(`.gitbin/vaults/${root}/`) &&
      /\/(notes|attachments)\/[^/]+\.bin$/.test(path) &&
      !states.has(path)
    )
      throw new Error(
        "Repository contains state missing from its inventory. Reinitialize the repository.",
      );
    if (
      path.startsWith(`${root}/`) &&
      !hiddenPath(path.slice(root.length + 1)) &&
      !visible.has(path)
    )
      throw new Error(
        "Repository contains a file missing from its inventory. Reinitialize the repository.",
      );
  }
}

export function contentCatalog(session: ReturnType<typeof gitSession>) {
  const boundedBlob = async (hash: string, limit = Infinity): Promise<Uint8Array> => {
    const repo = await session.repo();
    await session.hydrate(repo, [hash]);
    const bytes = await readBlob(repo, hash);
    if (bytes.length > limit) throw new Error("Repository metadata exceeds this device's limit.");
    return bytes;
  };
  const read = Effect.fn("catalog.read")(function* (
    vault: Registration,
  ): Effect.fn.Return<Catalog, SyncError> {
    yield* attempt("Invalid vault.", () => {
      validateVaults([vault]);
    });
    const fetched = yield* io("Cannot fetch repository inventory.", session.fetch);
    if (!fetched.revision) {
      if (fetched.hasBranches)
        return yield* new SyncError({
          message: "This repository has branches but no main. Create main before connecting.",
        });
      return { revision: null, consolidationHash: null, vaults: [], inventory: { files: [] } };
    }
    const entries = yield* io("Cannot read committed file paths.", () =>
      readEntries(fetched.repo, fetched.revision as string, vault),
    );
    const hash = entries.get(metadataPath);
    const bytes = hash
      ? yield* io("Cannot read repository metadata.", () => boundedBlob(hash))
      : undefined;
    const metadata = yield* attempt("Cannot validate repository metadata.", () =>
      requireCurrentMetadata(bytes ? JSON.parse(new TextDecoder().decode(bytes)) : undefined),
    );
    const vaults = yield* attempt("Cannot discover vaults.", () => discoverVaults(entries));
    const inventoryHash = entries.get(inventoryPath(vault.root));
    const encoded = inventoryHash
      ? yield* io("Cannot fetch vault inventory.", () => boundedBlob(inventoryHash))
      : null;
    const inventory = yield* attempt(
      "Repository metadata is inconsistent. Reinitialize the repository in Settings, then sync again.",
      () => {
        const result = encoded ? decodeInventory(encoded, vault.root) : { files: [] };
        checkTree(result, entries, vault);
        return result;
      },
    );
    return {
      revision: fetched.revision,
      consolidationHash: metadata.consolidationHash,
      vaults,
      inventory,
    };
  });
  const object = Effect.fn("catalog.object")(function* (reference: ObjectReference, limit: number) {
    yield* attempt("Object exceeds this device's download limit.", () => {
      if (!Number.isSafeInteger(limit) || limit < 0 || reference.bytes > limit)
        throw new Error("Object exceeds this device's download limit.");
    });
    const bytes = yield* io("Cannot download this file. Connect and try again.", () =>
      boundedBlob(reference.hash, limit),
    );
    yield* attempt("Downloaded content does not match its inventory.", () =>
      verifyObject(bytes, reference),
    );
    return bytes;
  });
  return { read, object };
}
