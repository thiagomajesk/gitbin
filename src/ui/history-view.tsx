import { ItemView, type WorkspaceLeaf } from "obsidian";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type GitbinPlugin from "../main";
import { FileHistoryModal } from "./file-history-modal";
import { HistoryPanel } from "./history-panel";

export const historyType = "gitbin-history";
export class HistoryView extends ItemView {
  private root: Root | undefined;
  private comparison: FileHistoryModal | undefined;
  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: GitbinPlugin,
  ) {
    super(leaf);
  }
  override getViewType(): string {
    return historyType;
  }
  override getDisplayText(): string {
    return "Gitbin";
  }
  override getIcon(): string {
    return "folder-git-2";
  }
  override async onOpen(): Promise<void> {
    this.contentEl.addClass("gitbin-view");
    this.root = createRoot(this.contentEl);
    this.root.render(
      createElement(HistoryPanel, {
        store: this.plugin.ui,
        openFile: (selection) => {
          this.comparison?.close();
          this.comparison = new FileHistoryModal(this.app, selection);
          this.comparison.open();
        },
      }),
    );
  }
  override async onClose(): Promise<void> {
    this.comparison?.close();
    this.comparison = undefined;
    this.root?.unmount();
    this.root = undefined;
    this.contentEl.empty();
  }
}
