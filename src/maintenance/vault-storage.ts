import { Schema } from "effect";
import { attempt } from "../core/errors";
import { HistoryState } from "../core/history";
import { statePath } from "../core/storage-layout";
import { journalData } from "./metadata";
import type { MigrationSnapshot, StorageMigration } from "./types";
import { validateCurrent } from "./validation";

function relocate(source: MigrationSnapshot): MigrationSnapshot {
  const files = new Map(source.files);
  for (const [path, bytes] of source.files) {
    const state = /^\.gitbin\/vaults\/([^/]+)\/([a-f0-9-]{36})\.bin$/.exec(path);
    const blob = /^\.gitbin\/blobs\/([^/]+)\/([a-f0-9]{40})$/.exec(path);
    const target =
      state?.[1] && state[2]
        ? statePath(state[1], state[2], bytes)
        : blob
          ? ".gitbin/vaults/" + blob[1] + "/retained/" + blob[2]
          : null;
    if (target) {
      if (files.has(target)) throw new Error("Conflicting storage paths.");
      files.set(target, bytes);
      files.delete(path);
    }
  }
  return { ...source, files };
}
export const vaultStorageMigration: StorageMigration = {
  id: "vault-storage",
  title: "Compact vault storage",
  inspect: (source) =>
    attempt("Cannot inspect vault storage.", () => {
      const needed =
        source.kind === "device"
          ? !("checkpoint" in journalData(source))
          : [...source.files.keys()].some(
              (path) =>
                path.startsWith(".gitbin/blobs/") ||
                /^\.gitbin\/vaults\/[^/]+\/[^/]+\.bin$/.test(path),
            );
      return { status: needed ? "needed" : "satisfied" };
    }),
  transform: (source) =>
    attempt("Cannot migrate vault storage.", () => {
      if (source.kind === "repository") return relocate(source);
      const journal = journalData(source);
      const files = new Map(source.files);
      let checkpoint = journal.checkpoint ?? null;
      if (checkpoint === null && files.has("history.json")) {
        try {
          checkpoint =
            Schema.decodeUnknownSync(HistoryState)(
              JSON.parse(new TextDecoder().decode(files.get("history.json"))),
            ).checkpoint?.map(({ id, path, hash }) => ({ id, path, hash })) ?? null;
        } catch {
          checkpoint = null;
        }
      }
      files.set(
        "journal.json",
        new TextEncoder().encode(JSON.stringify({ ...journal, checkpoint })),
      );
      return { ...source, files };
    }),
  validate: (source) => attempt("Invalid vault storage.", () => validateCurrent(source)),
};
