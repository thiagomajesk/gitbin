import { Check, Copy } from "lucide-react";
import { type App, apiVersion, Modal, Platform } from "obsidian";
import { useState, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ActivityEntries } from "./activity-entries";
import { IconButton } from "./icon-button";
import type { UiStore } from "./store";

export function ActivityPanel({
  store,
  version,
}: {
  readonly store: UiStore;
  readonly version: string;
}) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [copied, setCopied] = useState("");
  const entries = snapshot.activity ?? [];
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(
          {
            pluginVersion: version,
            obsidianApi: apiVersion,
            platform: Platform.isMobile ? "mobile" : "desktop",
            status: snapshot.status,
            phase: snapshot.phase,
            settings: {
              autoSync: snapshot.config.autoSync,
              downloadMode: snapshot.config.downloadMode,
              storageMegabytes: snapshot.config.storageMegabytes,
              maxDownloadMegabytes: snapshot.config.maxDownloadMegabytes,
            },
            activity: entries,
          },
          null,
          2,
        ),
      );
      setCopied("Diagnostics copied");
    } catch {
      setCopied("Could not copy diagnostics. Try again.");
    }
  };
  return (
    <div className="gitbin-log-box">
      <div className="gitbin-log-toolbar">
        <span
          role="status"
          className={copied === "Diagnostics copied" ? "gitbin:sr-only" : "gitbin-log-details"}
        >
          {copied}
        </span>
        <IconButton label="Copy diagnostics" onClick={() => void copy()}>
          {copied === "Diagnostics copied" ? (
            <Check aria-hidden="true" className="svg-icon" />
          ) : (
            <Copy aria-hidden="true" className="svg-icon" />
          )}
        </IconButton>
      </div>
      {snapshot.activityWarning ? (
        <p className="gitbin-status-warning">{snapshot.activityWarning}</p>
      ) : null}
      {entries.length === 0 ? (
        <p className="gitbin-log-empty">No activity yet. Sync to see what happens here.</p>
      ) : (
        <ActivityEntries entries={entries} />
      )}
    </div>
  );
}
export class ActivityModal extends Modal {
  private root: Root | undefined;
  constructor(
    app: App,
    private readonly store: UiStore,
    private readonly version: string,
  ) {
    super(app);
  }
  override onOpen(): void {
    this.setTitle("Sync log");
    this.modalEl.classList.add("gitbin-activity-modal");
    this.root = createRoot(this.contentEl);
    this.root.render(<ActivityPanel store={this.store} version={this.version} />);
  }
  override onClose(): void {
    this.root?.unmount();
    this.root = undefined;
  }
}
