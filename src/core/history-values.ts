import type { Change, Snapshot } from "./decisions";
export type HistoryRecord = {
  id: string;
  at: number;
  revision: string | null;
  baselineKnown: boolean;
  changes: readonly Change[];
};
export type HistoryValue = {
  checkpoint: readonly Snapshot[] | null;
  entries: readonly HistoryRecord[];
};
export function emptyHistory(): HistoryValue {
  //@ verify
  //@ ensures \result.checkpoint === null && \result.entries.length === 0
  return { checkpoint: null, entries: [] };
}
