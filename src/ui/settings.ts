import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PluginSettingTab, type App, type SettingDefinitionItem } from "obsidian";
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
  override getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: "Repository and sync",
        aliases: [
          "Repository URL",
          "Username",
          "Password or access token",
          "Author email",
          "Scan to sync",
          "Sync automatically",
          "Send local changes after",
          "Check for remote changes every",
        ],
        render: (setting) => {
          this.dispose();
          setting.settingEl.empty();
          setting.settingEl.removeClass("setting-item");
          const root = createRoot(setting.settingEl);
          this.root = root;
          root.render(createElement(SetupForm, { actions: pluginActions(this.plugin) }));
          return () => {
            if (this.root === root) this.dispose();
          };
        },
      },
    ];
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
