export function descendingId(left: string, right: string): number {
  //@ verify
  //@ ensures left < right ==> \result === 1
  //@ ensures left > right ==> \result === -1
  //@ ensures left === right ==> \result === 0
  return left < right ? 1 : left > right ? -1 : 0;
}
export function historyLocationOrder(left: string, right: string): number {
  //@ verify
  //@ ensures \result === (left < right ? 1 : -1)
  return left < right ? 1 : -1;
}
