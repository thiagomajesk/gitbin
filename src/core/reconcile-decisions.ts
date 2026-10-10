export function conflict(
  local: string | null,
  incoming: string | null,
  base: string | null,
  hasBase: boolean,
): boolean {
  //@ verify
  //@ ensures !hasBase ==> \result === (local !== incoming)
  //@ ensures hasBase ==> \result === (local !== base && incoming !== base && local !== incoming)
  return (!hasBase || local !== base) && (!hasBase || incoming !== base) && local !== incoming;
}
export function unchangedCheckpoint(
  hasBase: boolean,
  hash: string,
  baseHash: string,
  path: string | null,
  basePath: string | null,
): boolean {
  //@ verify
  //@ ensures \result === (hasBase && hash === baseHash && path === basePath)
  return hasBase && hash === baseHash && path === basePath;
}
export function rebasedEdit(
  hasState: boolean,
  hasPath: boolean,
  hasDisk: boolean,
  diskMatches: boolean,
  remoteMatches: boolean,
): boolean {
  //@ verify
  //@ ensures \result === (!hasState && hasPath && hasDisk && !diskMatches && !remoteMatches)
  return !hasState && hasPath && hasDisk && !diskMatches && !remoteMatches;
}
export function writeDisposition(
  hasBefore: boolean,
  hasOwner: boolean,
  equal: boolean,
): "blocked" | "unchanged" | "write" {
  //@ verify
  //@ ensures (\result === "blocked") === (hasBefore && !hasOwner && !equal)
  //@ ensures (\result === "unchanged") === equal
  //@ ensures (\result === "write") === (!equal && (!hasBefore || hasOwner))
  if (hasBefore && !hasOwner && !equal) return "blocked";
  return equal ? "unchanged" : "write";
}
