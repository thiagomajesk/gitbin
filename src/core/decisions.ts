/** Pure decisions used by the runtime and verified by LemmaScript. */
export type ConnectionIdentity = {
  remote: string;
  root: string;
  username: string;
  commitEmail: string;
  secretId: string;
};
export type Snapshot = {
  id: string;
  path: string | null;
  text: string | null;
  binary: boolean;
  hash: string;
};
export type ChangeKind = "combined" | "local" | "incoming" | "synced";
export type Change = {
  kind: ChangeKind;
  baseline: Snapshot | null;
  local: Snapshot | null;
  incoming: Snapshot | null;
  result: Snapshot;
};
export type MigrationSequence = "supported" | "newer" | "invalid";

export function connectionChanged(left: ConnectionIdentity, right: ConnectionIdentity): boolean {
  //@ verify
  //@ contract A connection changes exactly when one of its five identity fields changes.
  //@ ensures \result === (left.remote !== right.remote || left.root !== right.root || left.username !== right.username || left.commitEmail !== right.commitEmail || left.secretId !== right.secretId)
  return (
    left.remote !== right.remote ||
    left.root !== right.root ||
    left.username !== right.username ||
    left.commitEmail !== right.commitEmail ||
    left.secretId !== right.secretId
  );
}

export function same(left: Snapshot | null, right: Snapshot | null): boolean {
  //@ verify
  //@ contract Snapshots match exactly when both are absent or their paths and content hashes match.
  //@ ensures left === null ==> \result === (right === null)
  //@ ensures right === null ==> \result === (left === null)
  //@ ensures left !== null ==> right !== null ==> \result === (left.path === right.path && left.hash === right.hash)
  if (left === null) return right === null;
  if (right === null) return false;
  return left.path === right.path && left.hash === right.hash;
}

export function changeKind(
  baseline: Snapshot | null,
  local: Snapshot | null,
  incoming: Snapshot | null,
  known: boolean,
): ChangeKind {
  //@ verify
  //@ contract Unknown baselines are synced; divergent edits on both sides are combined; otherwise incoming changes take precedence.
  //@ ensures !known ==> \result === "synced"
  //@ ensures known && !same(baseline, local) && !same(baseline, incoming) && !same(local, incoming) ==> \result === "combined"
  //@ ensures known && (same(baseline, local) || same(baseline, incoming) || same(local, incoming)) ==> \result === (same(baseline, incoming) ? "local" : "incoming")
  if (!known) return "synced";
  const localChanged = !same(baseline, local);
  const incomingChanged = !same(baseline, incoming);
  if (localChanged && incomingChanged && !same(local, incoming)) return "combined";
  return incomingChanged ? "incoming" : "local";
}

export function describeChange(
  baseline: Snapshot | null,
  local: Snapshot | null,
  incoming: Snapshot | null,
  result: Snapshot,
  known: boolean,
): Change | null {
  //@ verify
  //@ contract Omit unchanged comparisons and unknown deletions; otherwise preserve every snapshot and classify the change.
  //@ ensures (\result === null) === ((known && same(baseline, result) && same(local, incoming)) || (!known && result.path === null))
  //@ ensures \result !== null ==> \result.baseline === baseline && \result.local === local && \result.incoming === incoming && \result.result === result && \result.kind === changeKind(baseline, local, incoming, known)
  if (known && same(baseline, result) && same(local, incoming)) return null;
  if (!known && result.path === null) return null;
  return { kind: changeKind(baseline, local, incoming, known), baseline, local, incoming, result };
}

export function migrationSequence(
  applied: readonly string[],
  expected: readonly string[],
): MigrationSequence {
  //@ verify
  //@ contract Unknown migration IDs require a newer app; known IDs must form an ordered prefix of the supported sequence.
  //@ ensures (\result === "newer") === exists(i, 0 <= i && i < applied.length && !expected.includes(applied[i]))
  //@ ensures (\result === "supported") === (applied.length <= expected.length && forall(i, 0 <= i && i < applied.length ==> applied[i] === expected[i]))
  //@ ensures (\result === "invalid") === (forall(i, 0 <= i && i < applied.length ==> expected.includes(applied[i])) && !(applied.length <= expected.length && forall(i, 0 <= i && i < applied.length ==> applied[i] === expected[i])))
  if (applied.some((id) => !expected.includes(id))) return "newer";
  if (applied.length > expected.length) return "invalid";
  for (let index = 0; index < applied.length; index++) {
    //@ invariant 0 <= index && index <= applied.length
    //@ invariant forall(j, 0 <= j && j < index ==> applied[j] === expected[j])
    //@ decreases applied.length - index
    if (applied[index] !== expected[index]) return "invalid";
  }
  return "supported";
}

/** Both arguments have already undergone the runtime's Unicode case normalization. */
export function ownerAt(owners: readonly string[], key: string): string | undefined {
  //@ verify
  //@ contract Find a path owner with an exact, ancestor, or descendant collision; return nothing exactly when no collision exists.
  //@ ensures \result !== undefined ==> owners.includes(\result) && (\result === key || \result.startsWith(key + "/") || key.startsWith(\result + "/"))
  //@ ensures (\result === undefined) === forall(i, 0 <= i && i < owners.length ==> !(owners[i] === key || owners[i].startsWith(key + "/") || key.startsWith(owners[i] + "/")))
  //@ ensures \result !== undefined ==> exists(i, 0 <= i && i < owners.length && owners[i] === \result && (owners[i] === key || owners[i].startsWith(key + "/") || key.startsWith(owners[i] + "/")) && forall(j, 0 <= j && j < i ==> !(owners[j] === key || owners[j].startsWith(key + "/") || key.startsWith(owners[j] + "/"))))
  return owners.find(
    (existing) =>
      existing === key || existing.startsWith(key + "/") || key.startsWith(existing + "/"),
  );
}
