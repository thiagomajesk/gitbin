import { Modal, type App } from "obsidian";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { ConsolidationPanel, type ConsolidationSummary } from "./consolidation-panel";
export class ConsolidationModal extends Modal {
  private root: Root | undefined;
  private applying = false;
  constructor(
    app: App,
    private readonly summary: ConsolidationSummary,
    private readonly apply: (report: (message: string) => void) => Promise<void>,
    private readonly closed: () => void,
  ) {
    super(app);
  }
  override onOpen(): void {
    this.setTitle(this.summary.reinitialize ? "Reinitialize repository" : "Consolidate repository");
    this.modalEl.classList.add("gitbin-consolidation-modal");
    this.root = createRoot(this.contentEl);
    flushSync(() => this.render());
  }
  private render(): void {
    this.root?.render(
      <ConsolidationPanel
        summary={this.summary}
        apply={async (report) => {
          this.applying = true;
          try {
            await this.apply(report);
          } finally {
            this.applying = false;
          }
        }}
        cancel={() => this.close()}
      />,
    );
  }
  override close(): void {
    if (!this.applying) super.close();
  }
  override onClose(): void {
    this.root?.unmount();
    this.root = undefined;
    this.closed();
  }
}
