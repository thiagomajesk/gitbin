export function automaticSyncReady(autoSync: boolean, hasUploadTimer: boolean): boolean {
  //@ verify
  //@ ensures \result === (autoSync && !hasUploadTimer)
  return autoSync && !hasUploadTimer;
}
export function backgroundReady(connected: boolean, layoutReady: boolean): boolean {
  //@ verify
  //@ ensures \result === (connected && layoutReady)
  return connected && layoutReady;
}
export function captureReady(layoutReady: boolean, attached: boolean, hasEngine: boolean): boolean {
  //@ verify
  //@ ensures \result === (layoutReady && attached && hasEngine)
  return layoutReady && attached && hasEngine;
}
export function syncOutcome(
  success: boolean,
  failed: boolean,
  retryable: boolean,
): "success" | "retry" | "stop" {
  //@ verify
  //@ ensures failed ==> \result === (retryable ? "retry" : "stop")
  //@ ensures !failed ==> \result === (success ? "success" : "stop")
  if (failed) return retryable ? "retry" : "stop";
  return success ? "success" : "stop";
}
export function installableJournal(
  current: string | null,
  original: string | null,
  migrated: string | null,
): boolean {
  //@ verify
  //@ ensures \result === (current === null || current === original || current === migrated)
  return current === null || current === original || current === migrated;
}
