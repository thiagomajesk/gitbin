import { useId, useState, useSyncExternalStore } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import type { SyncActions, UiSnapshot } from "./store";
import { IconButton } from "./icon-button";

function syncState(snapshot: UiSnapshot): string {
  if (!snapshot.config.setupComplete) return "Not connected";
  if (snapshot.error) return snapshot.issue?.title ?? "Last sync failed";
  if (snapshot.status === "Syncing…") return "Syncing your changes";
  if (snapshot.stale)
    return snapshot.status.startsWith("Offline") ? "Working offline" : "Last known state";
  if (snapshot.pending) return "Files waiting to sync";
  return repositoryState(snapshot);
}
function repositoryState(snapshot: UiSnapshot): string {
  const current = snapshot.vaults?.find((row) => row.connected);
  if (current?.changed === null) return "Not verified";
  if (current?.changed) return "Files waiting to sync";
  return snapshot.config.lastSync ? "All changes synced" : "Connected";
}
function time(value: number | null | undefined): string {
  return value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(value)
    : "Not yet";
}
function useManualSync(actions: SyncActions) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setPending(true);
    setError(null);
    try {
      if (!(await actions.synchronize()))
        setError("Sync could not finish. Your files are preserved. Try again.");
    } catch {
      setError("Sync could not finish. Your files are preserved. Try again.");
    } finally {
      setPending(false);
    }
  };
  return { pending, error, run };
}
function StatusRow({
  status,
  info,
  warning,
}: {
  readonly status: string;
  readonly info: string | null;
  readonly warning: boolean;
}) {
  const descriptionId = useId();
  const color = warning
    ? "gitbin-status-warning"
    : status === "All changes synced"
      ? "gitbin-status-current"
      : undefined;
  return (
    <div className="gitbin-sync-status-group">
      <dt>Status</dt>
      <dd role="status" className={color} aria-describedby={info ? descriptionId : undefined}>
        {status}
      </dd>
      {info ? (
        <dd className="gitbin-status-description">
          <p id={descriptionId} className="setting-item-description">
            {info}
          </p>
        </dd>
      ) : null}
    </div>
  );
}
function syncBlocked(snapshot: UiSnapshot): boolean {
  return snapshot.issue?.kind === "migration-required" || snapshot.issue?.kind === "newer-format";
}
export function SyncStatus({ actions }: { readonly actions: SyncActions }) {
  const headingId = useId();
  const snapshot = useSyncExternalStore(actions.store.subscribe, actions.store.getSnapshot);
  const manual = useManualSync(actions);
  const busy = manual.pending || snapshot.status === "Syncing…";
  const current = snapshot.vaults?.find((row) => row.connected);
  const status = manual.error && !snapshot.error ? "Last sync failed" : syncState(snapshot);
  const statusInfo = snapshot.issue?.message ?? snapshot.error ?? manual.error;
  const blocked = syncBlocked(snapshot);
  return (
    <section aria-labelledby={headingId} className="setting-group gitbin-sync-status">
      <div className="gitbin-settings-header">
        <h3 id={headingId} className="setting-item-heading">
          Sync status
        </h3>
        {snapshot.config.setupComplete ? (
          <IconButton
            label="Sync now"
            type="button"
            disabled={busy || blocked}
            aria-busy={busy}
            onClick={() => void manual.run()}
          >
            {busy ? (
              <LoaderCircle aria-hidden="true" className="svg-icon gitbin-spinner" />
            ) : (
              <RefreshCw aria-hidden="true" className="svg-icon" />
            )}
          </IconButton>
        ) : null}
      </div>
      <div className="setting-items gitbin:grid gitbin:gap-[var(--size-4-4)] gitbin:p-[var(--size-4-5)]">
        <dl className="gitbin-summary">
          <StatusRow status={status} info={statusInfo} warning={blocked} />
          {snapshot.config.setupComplete ? (
            <>
              <div className="gitbin-sync-status-group">
                <dt>Current remote commit</dt>
                <dd>
                  <code>{current?.latest?.slice(0, 8) ?? "Not verified"}</code>
                </dd>
                <dt>Current local commit</dt>
                <dd>
                  <code>{snapshot.config.lastRevision?.slice(0, 8) ?? "Not verified"}</code>
                </dd>
              </div>
              <div className="gitbin-sync-status-group">
                <dt>Last synced</dt>
                <dd>{time(snapshot.config.lastSync)}</dd>
                <dt>Last checked</dt>
                <dd>{time(snapshot.checkedAt)}</dd>
              </div>
            </>
          ) : null}
        </dl>
      </div>
    </section>
  );
}
