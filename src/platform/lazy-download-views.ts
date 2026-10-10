import { FileView, type Plugin } from "obsidian";
import { mountProgress } from "../ui/progress";
import type { DownloadActions } from "./lazy-editor";

export class LazyDownloadViews {
  private readonly rendered = new WeakMap<Element, string>();
  constructor(
    private readonly plugin: Plugin,
    private readonly actions: DownloadActions,
    private readonly busy: (path: string) => boolean,
  ) {
    plugin.register(() => {
      plugin.app.workspace.iterateAllLeaves(({ view }) => {
        view.containerEl.querySelector(".gitbin-download-panel")?.remove();
        view.containerEl.removeClass("gitbin-download-pending");
      });
    });
  }

  shows(path: string): boolean {
    let found = false;
    this.plugin.app.workspace.iterateAllLeaves(({ view }) => {
      if (
        view instanceof FileView &&
        view.file?.path === path &&
        view.containerEl.querySelector(".gitbin-download-panel")
      )
        found = true;
    });
    return found;
  }

  refresh(): void {
    this.plugin.app.workspace.iterateAllLeaves(({ view }) => {
      if (!(view instanceof FileView) || !view.file) return;
      const panel = view.containerEl.querySelector(".gitbin-download-panel");
      const message = this.actions.status(view.file.path);
      if (message) this.render(view, message);
      else if (panel) {
        panel.remove();
        view.containerEl.removeClass("gitbin-download-pending");
        const file = view.file;
        void view.onLoadFile(file).catch(() => {
          if (view.file === file)
            this.render(view, "Could not open this file. Close and reopen it to try again.");
        });
      }
    });
  }

  private render(view: FileView, message: string): void {
    const file = view.file;
    if (!file) return;
    const busy = this.busy(file.path);
    const online = navigator.onLine;
    const existing = view.containerEl.querySelector(".gitbin-download-panel");
    const state = JSON.stringify([file.path, file.name, busy, online, busy ? "" : message]);
    if (existing && this.rendered.get(existing) === state) return;
    view.containerEl.addClass("gitbin-download-pending");
    existing?.remove();
    const panel = view.contentEl.createDiv({ cls: "gitbin-download-panel" });
    this.rendered.set(panel, state);
    panel.setAttribute("role", "status");
    panel.createEl("strong", { text: file.name });
    panel.createEl("p", {
      text: busy
        ? "Downloading…"
        : online
          ? message
          : "Connect to the internet to download this file.",
    });
    if (busy)
      mountProgress(panel.createDiv({ attr: { "aria-label": `Downloading ${file.name}` } }));
  }
}
