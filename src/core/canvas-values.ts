export function visibleCanvasEntity(
  deleted: boolean,
  edge: boolean,
  from: boolean,
  to: boolean,
): boolean {
  //@ verify
  //@ ensures \result === (!deleted && (!edge || (from && to)))
  return !deleted && (!edge || (from && to));
}
