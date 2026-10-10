import { Effect } from "effect";
import type { GitContext } from "just-git";
import { readBlob } from "just-git/repo";
import { io } from "../core/errors";
import { metadataEntry } from "../core/path-rules";
import type { gitSession } from "./session";

export const readMaintenanceFiles = Effect.fn("maintenance.readFiles")(function* (
  session: ReturnType<typeof gitSession>,
  repo: GitContext,
  entries: readonly { readonly path: string; readonly hash: string }[],
  rebuilding = false,
) {
  const files = new Map<string, Uint8Array>();
  for (const entry of entries) {
    if (rebuilding && metadataEntry(entry.path)) continue;
    const bytes = yield* io("Cannot read committed maintenance content.", async () => {
      if (!(await repo.objectStore.exists(entry.hash))) await session.hydrate(repo, [entry.hash]);
      return readBlob(repo, entry.hash);
    });
    files.set(entry.path, bytes);
  }
  return files;
});
