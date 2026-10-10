import { type App, Modal } from "obsidian";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { FileChange } from "../core/history";
import { FileHistory } from "./file-history";
import type { HistorySelection } from "./sync-history";

export class FileHistoryModal extends Modal {
  private root: Root | undefined;
  constructor(
    app: App,
    private readonly historySelection: HistorySelection,
    private readonly load?: (change: FileChange) => Promise<FileChange>,
    private readonly onDemand = false,
    private readonly cached?: (change: FileChange) => Promise<boolean>,
  ) {
    super(app);
  }
  override onOpen(): void {
    const count = this.historySelection.entry.changes.length;
    const date = new Date(this.historySelection.entry.at).toLocaleString();
    this.setTitle(`${count} ${count === 1 ? "file" : "files"} synced · ${date}`);
    this.modalEl.addClass("gitbin-history-modal");
    this.contentEl.addClass("gitbin-ui", "gitbin-history-comparison");
    this.root = createRoot(this.contentEl);
    this.root.render(
      createElement(FileHistory, {
        selection: this.historySelection,
        load: this.load,
        onDemand: this.onDemand,
        cached: this.cached,
      }),
    );
  }
  override onClose(): void {
    this.root?.unmount();
    this.root = undefined;
    this.contentEl.empty();
  }
}
