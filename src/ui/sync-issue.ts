import { SyncError } from "../core/errors";
export interface SyncIssue {
  readonly kind: "migration-required" | "newer-format" | "invalid-data";
  readonly title: string;
  readonly message: string;
  readonly details: string;
}
const descriptions = {
  "migration-required": {
    title: "Migration required",
    message:
      "Sync is currently paused due to pending migrations, please consolidate the repository",
  },
  "newer-format": {
    title: "Update required",
    message: "This vault requires a newer Gitbin version. Update the plugin to continue.",
  },
  "invalid-data": {
    title: "Cannot read sync data",
    message: "Gitbin couldn’t read its saved sync data. Your vault files haven’t been changed.",
  },
};
export function syncIssue(error: unknown): SyncIssue | null {
  let current = error;
  for (let depth = 0; depth < 8 && current instanceof Error; depth++) {
    if (current instanceof SyncError && current.code) {
      return {
        kind: current.code,
        ...descriptions[current.code],
        details:
          "Gitbin: " +
          current.code +
          "\n" +
          (current.detail ?? "Saved data could not be validated."),
      };
    }
    current = current.cause;
  }
  return null;
}
