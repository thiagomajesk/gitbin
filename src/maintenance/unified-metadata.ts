import { attempt } from "../core/errors";
import { currentMetadata, migrationIds } from "../core/metadata";
import { validateCurrent } from "./legacy-validation";
import { journalData, normalizeLegacyMetadata, snapshotMetadata, stampMetadata } from "./metadata";
import type { StorageMigration } from "./types";

export const unifiedMetadataMigration: StorageMigration = {
  id: "unified-metadata",
  title: "Consolidate repository metadata",
  inspect: (source) =>
    attempt("Cannot inspect repository metadata.", () => {
      const metadata = snapshotMetadata(source, migrationIds);
      const legacy =
        source.kind === "repository"
          ? source.files.has(".gitbin/format") || source.files.has(".gitbin/generation")
          : "version" in journalData(source) || "generation" in journalData(source);
      return { status: !metadata || legacy ? "needed" : "satisfied" };
    }),
  transform: (source) =>
    attempt("Cannot consolidate metadata.", () =>
      stampMetadata(
        normalizeLegacyMetadata(source),
        snapshotMetadata(source, migrationIds) ?? currentMetadata(),
      ),
    ),
  validate: (source) => attempt("Invalid consolidated metadata.", () => validateCurrent(source)),
};
