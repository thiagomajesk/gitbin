import { useSyncExternalStore } from "react";
import type { UiStore } from "./store";
import { type HistorySelection, SyncHistory } from "./sync-history";
export function HistoryPanel({
  store,
  openFile,
}: {
  readonly store: UiStore;
  readonly openFile: (selection: HistorySelection) => void;
}) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return (
    <div className="gitbin-ui gitbin-history-view">
      <SyncHistory
        openFile={openFile}
        entries={snapshot.history ?? []}
        warning={snapshot.historyWarning ?? null}
      />
    </div>
  );
}
