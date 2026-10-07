import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PluginSettingTab, type App } from "obsidian";
import type GitbinPlugin from "../main";
import { SetupForm } from "./setup-form";
import { pluginActions } from "./actions";

export class GitbinSettings extends PluginSettingTab {
  private root: Root | undefined;
  constructor(
    app: App,
    private readonly plugin: GitbinPlugin,
  ) {
    super(app, plugin);
  }
  override display(): void {
    this.dispose();
    this.containerEl.empty();
    this.root = createRoot(this.containerEl);
    this.root.render(
      createElement(SetupForm, {
        actions: pluginActions(this.plugin),
      }),
    );
  }
  override hide(): void {
    this.dispose();
    super.hide();
  }
  dispose(): void {
    this.root?.unmount();
    this.root = undefined;
  }
}
