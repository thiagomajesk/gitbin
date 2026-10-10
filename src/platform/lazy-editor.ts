import { EditorState, Prec, StateEffect, StateField } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { editorInfoField, Notice, type Plugin, TFile } from "obsidian";
import { LazyDownloadViews } from "./lazy-download-views";
import { LazyEmbeds } from "./lazy-embeds";

export interface DownloadActions {
  status(path: string): string | null;
  download(path: string): Promise<boolean>;
}
export class LazyEditor {
  private readonly editors = new Set<EditorView>();
  private readonly expected = new Map<string, string>();
  private readonly jobs = new Set<string>();
  private readonly refreshEffect = StateEffect.define<null>();
  private scheduled = false;
  private readonly embeds: LazyEmbeds;
  private readonly views: LazyDownloadViews;
  constructor(
    private readonly plugin: Plugin,
    private readonly actions: DownloadActions,
  ) {
    this.views = new LazyDownloadViews(plugin, actions, (path) => this.jobs.has(path));
    this.embeds = new LazyEmbeds(
      plugin,
      (path) => actions.status(path),
      (path) => this.download(path),
    );
  }

  install(): void {
    this.plugin.registerEditorExtension(this.extension());
    this.embeds.install();
    this.plugin.registerDomEvent(window, "online", () => this.refresh());
    this.plugin.registerDomEvent(window, "offline", () => this.refresh());
    this.plugin.registerEvent(this.plugin.app.workspace.on("layout-change", () => this.refresh()));
    this.plugin.registerEvent(
      this.plugin.app.workspace.on("file-open", (file) => {
        this.refresh();
        if (file && this.actions.status(file.path)) void this.download(file.path);
      }),
    );
    this.plugin.registerEvent(
      this.plugin.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFile)) return;
        if (this.actions.status(file.path))
          menu.addItem((item) =>
            item
              .setTitle("Gitbin: Download")
              .setIcon("download")
              .setDisabled(!navigator.onLine)
              .onClick(() => {
                void this.download(file.path, true);
              }),
          );
      }),
    );
    this.plugin.registerMarkdownPostProcessor((_element, context) => {
      if (this.actions.status(context.sourcePath)) this.refresh();
    });
    this.plugin.register(() => {
      this.editors.clear();
      this.expected.clear();
    });
  }
  private extension() {
    const editors = this.editors;
    const tick = StateField.define({
      create: () => 0,
      update: (value, transaction) =>
        transaction.effects.some((effect) => effect.is(this.refreshEffect)) ? value + 1 : value,
    });
    const path = (state: EditorState) => state.field(editorInfoField, false)?.file?.path;
    const message = (state: EditorState) => {
      const value = path(state);
      if (!value) return null;
      const status = this.actions.status(value);
      return status && this.jobs.has(value) ? "Downloading…" : status;
    };
    return [
      tick,
      ViewPlugin.fromClass(
        class {
          constructor(readonly view: EditorView) {
            editors.add(view);
          }
          destroy() {
            editors.delete(this.view);
          }
        },
      ),
      Prec.highest(
        EditorState.readOnly.compute([editorInfoField, tick], (state) => message(state) !== null),
      ),
      Prec.highest(
        EditorView.editable.compute([editorInfoField, tick], (state) => message(state) === null),
      ),
      EditorState.transactionFilter.of((transaction) =>
        message(transaction.startState) &&
        transaction.docChanged &&
        transaction.newDoc.toString() !== this.expected.get(path(transaction.startState) ?? "")
          ? []
          : transaction,
      ),
    ];
  }
  expect(path: string, text: string): void {
    this.expected.set(path, text);
  }
  active(path: string): boolean {
    let found = false;
    this.plugin.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view.getState().file === path) found = true;
    });
    return found || this.embeds.active(path);
  }
  showsDownload(path: string): boolean {
    return this.views.shows(path);
  }
  async download(path: string, announce = false): Promise<void> {
    if (!navigator.onLine || this.jobs.has(path)) return;
    this.jobs.add(path);
    this.refresh();
    const notice =
      announce && !this.views.shows(path) ? new Notice("Downloading " + path + "…", 0) : null;
    try {
      const downloaded = await this.actions.download(path);
      if (downloaded && notice) new Notice("Downloaded " + path);
    } finally {
      notice?.hide();
      this.jobs.delete(path);
      this.refresh();
    }
  }
  refresh(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      for (const editor of this.editors) editor.dispatch({ effects: this.refreshEffect.of(null) });
      this.views.refresh();
      this.embeds.refresh();
      for (const path of this.expected.keys())
        if (!this.actions.status(path)) this.expected.delete(path);
    });
  }
}
