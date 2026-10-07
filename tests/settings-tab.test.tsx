// @vitest-environment jsdom
import { act } from "@testing-library/react";
import { useEffect } from "react";
import { expect, it, vi } from "vitest";
import { Setting, type App, type SettingGroup } from "obsidian";
import type GitbinPlugin from "../src/main";
import { GitbinSettings } from "../src/ui/settings";

const lifecycle = vi.hoisted(() => ({ mounted: vi.fn(), disposed: vi.fn() }));
vi.mock("obsidian", () => ({
  PluginSettingTab: class {
    hide() {}
  },
  Setting: class {
    constructor(readonly settingEl: HTMLElement) {}
  },
}));
vi.mock("../src/ui/actions", () => ({ pluginActions: () => ({}) }));
vi.mock("../src/ui/setup-form", () => ({
  SetupForm: () => {
    useEffect(() => {
      lifecycle.mounted();
      return lifecycle.disposed;
    }, []);
    return (
      <label>
        Repository URL
        <input />
      </label>
    );
  },
}));

it("indexes without mounting and follows the native row render/cleanup lifecycle", () => {
  const tab = new GitbinSettings({} as App, {} as GitbinPlugin);
  const definitions = tab.getSettingDefinitions();
  expect(lifecycle.mounted).not.toHaveBeenCalled();
  const definition = definitions.find(
    (item) => "aliases" in item && item.aliases?.includes("Repository URL"),
  );
  if (!definition || !("render" in definition) || !definition.render)
    throw new Error("Missing searchable repository renderer");
  const host = document.createElement("div");
  host.empty = () => host.replaceChildren();
  host.removeClass = (...names) => host.classList.remove(...names);
  host.className = "setting-item";
  document.body.append(host);
  const render = () => {
    const dispose = definition.render(new Setting(host), {} as SettingGroup);
    if (typeof dispose !== "function") throw new Error("Missing row cleanup");
    return dispose;
  };
  let cleanup = () => {};
  act(() => {
    cleanup = render();
  });
  expect(host.querySelector("input")).not.toBeNull();
  expect(host.classList.contains("setting-item")).toBe(false);
  act(() => cleanup());
  expect(host.childElementCount).toBe(0);
  expect(lifecycle.disposed).toHaveBeenCalledTimes(1);
  act(() => {
    cleanup = render();
  });
  expect(host.querySelector("input")).not.toBeNull();
  act(() => tab.hide());
  expect(host.childElementCount).toBe(0);
  act(() => cleanup());
  expect(lifecycle.disposed).toHaveBeenCalledTimes(2);
  host.remove();
});
