import { SyncError } from "../core/errors";

import { type IssueCopy, issueValue } from "./issue-values";
export interface SyncIssue extends IssueCopy {
  readonly kind: "migration-required" | "newer-format" | "invalid-data";
}
export function syncIssue(error: unknown): SyncIssue | null {
  let current = error;
  for (let depth = 0; depth < 8 && current instanceof Error; depth++) {
    if (current instanceof SyncError && current.code) {
      return { kind: current.code, ...issueValue(current.code, current.detail ?? null) };
    }
    current = current.cause;
  }
  return null;
}
