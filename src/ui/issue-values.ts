export interface IssueCopy {
  readonly title: string;
  readonly message: string;
  readonly details: string;
}

export function issueValue(kind: string, detail: string | null): IssueCopy {
  //@ verify
  //@ ensures \result.details === "Gitbin: " + kind + "\n" + (detail === null ? "Saved data could not be validated." : detail)
  //@ ensures kind === "migration-required" ==> \result.title === "Migration required" && \result.message === "Sync is currently paused due to pending migrations, please consolidate the repository"
  //@ ensures kind === "newer-format" ==> \result.title === "Update required" && \result.message === "This vault requires a newer Gitbin version. Update the plugin to continue."
  //@ ensures kind !== "migration-required" && kind !== "newer-format" ==> \result.title === "Cannot read sync data" && \result.message === "Gitbin couldn’t read its saved sync data. Your vault files haven’t been changed."
  const details = "Gitbin: " + kind + "\n" + (detail ?? "Saved data could not be validated.");
  if (kind === "migration-required")
    return {
      details,
      title: "Migration required",
      message:
        "Sync is currently paused due to pending migrations, please consolidate the repository",
    };
  if (kind === "newer-format")
    return {
      details,
      title: "Update required",
      message: "This vault requires a newer Gitbin version. Update the plugin to continue.",
    };
  return {
    details,
    title: "Cannot read sync data",
    message: "Gitbin couldn’t read its saved sync data. Your vault files haven’t been changed.",
  };
}
