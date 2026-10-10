export function downloadSpace(state: number, content: number, write: number): number {
  //@ verify
  //@ ensures \result >= (state > 0 ? state * 3 + 65536 : 0)
  //@ ensures \result >= state + (content > 0 ? content * 3 + 65536 : 0)
  //@ ensures \result >= state + content + write + 1024
  //@ ensures \result === (state > 0 ? state * 3 + 65536 : 0) || \result === state + (content > 0 ? content * 3 + 65536 : 0) || \result === state + content + write + 1024
  const statePeak = state > 0 ? state * 3 + 65536 : 0;
  const contentPeak = state + (content > 0 ? content * 3 + 65536 : 0);
  const writePeak = state + content + write + 1024;
  if (statePeak >= contentPeak && statePeak >= writePeak) return statePeak;
  if (contentPeak >= writePeak) return contentPeak;
  return writePeak;
}

export function downloadAdmission(
  contentBytes: number,
  limit: number,
): "allowed" | "content-limit" {
  //@ verify
  //@ ensures (\result === "allowed") === (contentBytes <= limit)
  //@ ensures (\result === "content-limit") === (contentBytes > limit)
  return contentBytes > limit ? "content-limit" : "allowed";
}

export function conflictingBinary(
  local: string,
  incoming: string,
  changed: boolean,
  sameContent: boolean,
): boolean {
  //@ verify
  //@ ensures \result === (changed && !sameContent && (local === "binary" || incoming === "binary"))
  //@ ensures sameContent ==> !\result
  return changed && (local === "binary" || incoming === "binary") && !sameContent;
}

export function cappedDownloadLimit(requested: number, storage: number): number {
  //@ verify
  //@ ensures storage === 0 ==> \result === requested
  //@ ensures storage !== 0 && requested === 0 ==> \result === storage
  //@ ensures requested !== 0 && storage !== 0 ==> (\result === requested || \result === storage)
  //@ ensures requested !== 0 && storage !== 0 ==> (\result <= requested && \result <= storage)
  if (storage === 0) return requested;
  if (requested === 0) return storage;
  return requested <= storage ? requested : storage;
}
