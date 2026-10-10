export function syncBlocked(kind: string | null): boolean {
  //@ verify
  //@ ensures \result === (kind === "migration-required" || kind === "newer-format")
  return kind === "migration-required" || kind === "newer-format";
}
export function repositoryState(
  hasCurrent: boolean,
  changed: boolean | null,
  hasSync: boolean,
): string {
  //@ verify
  //@ ensures hasCurrent && changed === null ==> \result === "Not verified"
  //@ ensures hasCurrent && changed === true ==> \result === "Files waiting to sync"
  //@ ensures (!hasCurrent || changed === false) ==> \result === (hasSync ? "All changes synced" : "Connected")
  if (hasCurrent && changed === null) return "Not verified";
  if (hasCurrent && changed === true) return "Files waiting to sync";
  return hasSync ? "All changes synced" : "Connected";
}
export function syncState(
  connected: boolean,
  error: boolean,
  issue: string | null,
  status: string,
  stale: boolean,
  pending: boolean,
  repository: string,
): string {
  //@ verify
  //@ ensures !connected ==> \result === "Not connected"
  //@ ensures connected && error ==> \result === (issue === null ? "Last sync failed" : issue)
  //@ ensures connected && !error && status === "Syncing…" ==> \result === "Syncing your changes"
  //@ ensures connected && !error && status !== "Syncing…" && stale ==> \result === (status.startsWith("Offline") ? "Working offline" : "Last known state")
  //@ ensures connected && !error && status !== "Syncing…" && !stale ==> \result === (pending ? "Files waiting to sync" : repository)
  if (!connected) return "Not connected";
  if (error) return issue === null ? "Last sync failed" : issue;
  if (status === "Syncing…") return "Syncing your changes";
  if (stale) return status.startsWith("Offline") ? "Working offline" : "Last known state";
  if (pending) return "Files waiting to sync";
  return repository;
}
export function statusDescription(
  issue: string | null,
  error: string | null,
  manual: string | null,
): string | null {
  //@ verify
  //@ ensures issue !== null ==> \result === issue
  //@ ensures issue === null && error !== null ==> \result === error
  //@ ensures issue === null && error === null ==> \result === manual
  return issue ?? error ?? manual;
}
export function acknowledgementsAccepted(values: readonly boolean[]): boolean {
  //@ verify
  //@ ensures \result === !values.includes(false)
  return !values.some((value) => !value);
}
export function statusColor(warning: boolean, status: string): string | undefined {
  //@ verify
  //@ ensures warning ==> \result === "gitbin-status-warning"
  //@ ensures !warning ==> \result === (status === "All changes synced" ? "gitbin-status-current" : undefined)
  return warning
    ? "gitbin-status-warning"
    : status === "All changes synced"
      ? "gitbin-status-current"
      : undefined;
}

export function manualStatus(failed: boolean, storedError: boolean, status: string): string {
  //@ verify
  //@ ensures \result === (failed && !storedError ? "Last sync failed" : status)
  return failed && !storedError ? "Last sync failed" : status;
}
