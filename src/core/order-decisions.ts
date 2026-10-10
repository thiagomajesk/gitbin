export function historyLocationOrder(left: string, right: string): number {
  //@ verify
  //@ ensures \result === (left < right ? 1 : -1)
  return left < right ? 1 : -1;
}
