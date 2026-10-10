export interface FileContent {
  readonly type: "text" | "binary";
  readonly value: string;
}
export function textContent(value: string): FileContent {
  //@ verify
  //@ ensures \result.type === "text" && \result.value === value
  return { type: "text", value };
}
export function equalContent(left: FileContent | null, right: FileContent | null): boolean {
  //@ verify
  //@ ensures left === null ==> \result === (right === null)
  //@ ensures right === null ==> \result === (left === null)
  //@ ensures left !== null ==> right !== null ==> \result === (left.type === right.type && left.value === right.value)
  if (left === null) return right === null;
  if (right === null) return false;
  return left.type === right.type && left.value === right.value;
}
