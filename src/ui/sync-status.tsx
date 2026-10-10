import { LoaderCircle, RefreshCw } from "lucide-react";
import { useId, useState, useSyncExternalStore } from "react";
import { IconButton } from "./icon-button";
import {
  manualStatus,
  repositoryState,
  statusColor,
  statusDescription,
  syncBlocked,
  syncState,
} from "./status-decisions";
import type { SyncActions, UiSnapshot } from "./store";

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
  const color = statusColor(warning, status);
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

export function SyncStatus({ actions }: { readonly actions: SyncActions }) {
  const headingId = useId();
  const snapshot = useSyncExternalStore(actions.store.subscribe, actions.store.getSnapshot);
  const manual = useManualSync(actions);
  const busy = manual.pending || snapshot.status === "Syncing…";
  const { status, statusInfo, blocked } = snapshotStatus(snapshot, manual.error);
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
          {snapshot.config.setupComplete ? <SyncDetails snapshot={snapshot} /> : null}
        </dl>
      </div>
    </section>
  );
}

function SyncDetails({ snapshot }: { readonly snapshot: UiSnapshot }) {
  const current = snapshot.vaults?.find((row) => row.connected);
  return (
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
  );
}

function snapshotState(snapshot: UiSnapshot): string {
  const current = snapshot.vaults?.find((row) => row.connected);
  return syncState(
    snapshot.config.setupComplete,
    Boolean(snapshot.error),
    snapshot.issue?.title ?? null,
    snapshot.status,
    snapshot.stale ?? false,
    snapshot.pending ?? false,
    repositoryState(
      current !== undefined,
      current?.changed ?? null,
      Boolean(snapshot.config.lastSync),
    ),
  );
}

function snapshotStatus(snapshot: UiSnapshot, error: string | null) {
  return {
    status: manualStatus(Boolean(error), Boolean(snapshot.error), snapshotState(snapshot)),
    statusInfo: statusDescription(snapshot.issue?.message ?? null, snapshot.error, error),
    blocked: syncBlocked(snapshot.issue?.kind ?? null),
  };
}
