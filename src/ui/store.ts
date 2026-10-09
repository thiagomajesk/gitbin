import type { SyncIssue } from "./sync-issue";
import type { VaultStatus } from "../git/status";
import type { Config } from "../core/config";
import type { HistoryEntry } from "../core/history";

export interface UiSnapshot {
  readonly history?: ReadonlyArray<HistoryEntry>;
  readonly historyWarning?: string | null;
  readonly vaults?: ReadonlyArray<VaultStatus>;
  readonly checkedAt?: number;
  readonly stale?: boolean;
  readonly pending?: boolean;
  readonly config: Config;
  readonly status: string;
  readonly error: string | null;
  readonly issue?: SyncIssue | null;
}

export function createUiStore(initial: UiSnapshot) {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update: (patch: Partial<UiSnapshot>) => {
      snapshot = { ...snapshot, ...patch, ...(patch.error === null ? { issue: null } : {}) };
      for (const listener of listeners) listener();
    },
  };
}
export type UiStore = ReturnType<typeof createUiStore>;

export interface SyncActions {
  readonly store: UiStore;
  synchronize(): Promise<boolean>;
}
