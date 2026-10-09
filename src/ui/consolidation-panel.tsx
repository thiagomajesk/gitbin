import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Button } from "./controls";
export interface ConsolidationSummary {
  readonly reinitialize?: boolean;
  readonly vaults: readonly string[];
}
export function ConsolidationPanel({
  summary,
  apply,
  cancel,
}: {
  readonly summary: ConsolidationSummary;
  readonly apply: (report: (message: string) => void) => Promise<void>;
  readonly cancel: () => void;
}) {
  const action = summary.reinitialize ? "Reinitialize" : "Consolidate";
  const [acknowledgements, setAcknowledgements] = useState([false, false, false]);
  const accepted = acknowledgements.every(Boolean);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const submit = async () => {
    if (!accepted || busy) return;
    setBusy(true);
    setError("");
    setProgress("Waiting for the current task…");
    try {
      await apply(setProgress);
      cancel();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Consolidation failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="gitbin-ui gitbin-consolidation">
      <MaintenanceExplanation summary={summary} />
      <div className="gitbin-consolidation-confirmation">
        <fieldset className="gitbin-consolidation-checklist" disabled={busy}>
          <legend>Before you continue</legend>
          {acknowledgementLabels.map((label, index) => (
            <label key={label} className="gitbin-consolidation-acknowledgement">
              <input
                type="checkbox"
                checked={acknowledgements[index] ?? false}
                onChange={(event) =>
                  setAcknowledgements((current) =>
                    current.map((value, position) =>
                      position === index ? event.target.checked : value,
                    ),
                  )
                }
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        {error ? (
          <p className="gitbin-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="gitbin-consolidation-actions">
          <Button type="button" disabled={busy} onClick={cancel}>
            Cancel
          </Button>
          <Button
            type="button"
            className="mod-warning"
            disabled={!accepted || busy}
            onClick={() => void submit()}
          >
            {busy ? "Applying…" : action}
          </Button>
        </div>
        {busy ? (
          <div className="gitbin-maintenance-progress">
            <progress aria-label="Repository maintenance progress" />
            <p role="status">{progress}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

const acknowledgementLabels = [
  "I’ve reviewed what this action will change and understand its impact",
  "I’ve backed up everything I want to keep, including changes that haven’t synced yet",
  "I understand this action can’t be undone and previous versions will no longer be available",
];
function MaintenanceExplanation({ summary }: { readonly summary: ConsolidationSummary }) {
  return (
    <>
      {" "}
      <p>
        {summary.reinitialize ? (
          <>
            Use this when damaged metadata prevents syncing. This replaces the existing metadata and
            rebuilds it from the latest committed files in your repository
          </>
        ) : (
          <>
            Use this to clear accumulated history and keep your repository easier to maintain. This
            preserves the latest committed files and valid metadata
          </>
        )}
      </p>
      <div className="gitbin-consolidation-warning">
        <TriangleAlert aria-hidden="true" />
        <p>
          This action will force-push the repository and replace its history with a single revision.
          Previous revisions will be removed from history and will no longer be available to restore
        </p>
      </div>
    </>
  );
}
