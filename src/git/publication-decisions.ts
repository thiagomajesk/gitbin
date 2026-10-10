export function publicationState(
  current: string | null,
  expected: string,
  revision: string,
): "complete" | "pending" | "stale" | "inspect" {
  //@ verify
  //@ ensures current === revision ==> \result === "complete"
  //@ ensures current !== revision && current === expected ==> \result === "pending"
  //@ ensures current === null ==> \result === "stale"
  //@ ensures current === "" && current !== revision && current !== expected ==> \result === "stale"
  //@ ensures current !== null && current !== "" && current !== revision && current !== expected ==> \result === "inspect"
  if (current === revision) return "complete";
  if (current === expected) return "pending";
  if (current === null || current === "") return "stale";
  return "inspect";
}
export function sameConsolidation(before: string | null, after: string | null): boolean {
  //@ verify
  //@ ensures before === null ==> !\result
  //@ ensures before !== null ==> \result === (before !== "" && before === after)
  if (before === null) return false;
  return before !== "" && before === after;
}
