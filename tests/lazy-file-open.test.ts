// @vitest-environment jsdom
import { StateField } from "@codemirror/state";
import type { Plugin } from "obsidian";
import { afterEach, expect, it, vi } from "vitest";
import { LazyEditor } from "../src/platform/lazy-editor";

const { notice, hideNotice } = vi.hoisted(() => ({ notice: vi.fn(), hideNotice: vi.fn() }));
vi.mock("obsidian", () => ({
  editorInfoField: StateField.define({ create: () => ({}), update: (value) => value }),
  Notice: class {
    constructor(message: string) {
      notice(message);
    }
    hide = hideNotice;
  },
  FileView: class {},
  MarkdownView: class {},
  TFile: class {},
}));
afterEach(() => vi.unstubAllGlobals());
it.each(["pdf", "gif", "svg", "mp3", "custom"])(
  "starts a download when Obsidian opens a %s file",
  async (extension) => {
    notice.mockClear();
    hideNotice.mockClear();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    const events = new Map<string, (file: { path: string; extension: string }) => void>();
    const plugin = {
      register: vi.fn(),
      registerEditorExtension: vi.fn(),
      registerEvent: vi.fn(),
      registerDomEvent: vi.fn(),
      registerMarkdownPostProcessor: vi.fn(),
      app: {
        workspace: {
          on: (name: string, callback: (file: { path: string; extension: string }) => void) =>
            events.set(name, callback),
          iterateAllLeaves: vi.fn(),
        },
        metadataCache: { on: vi.fn() },
      },
    } as unknown as Plugin;
    const download = vi.fn(async () => false);
    const editor = new LazyEditor(plugin, {
      status: () => "Not downloaded",
      download,
    });
    editor.install();
    const file = { path: "File." + extension, extension };
    events.get("file-open")?.(file);
    await Promise.resolve();
    expect(download).toHaveBeenCalledWith(file.path);
    events.get("file-open")?.(file);
    await Promise.resolve();
    expect(download).toHaveBeenCalledTimes(2);
    expect(notice).not.toHaveBeenCalled();
    await editor.download(file.path, true);
    expect(notice).toHaveBeenCalledTimes(1);
    expect(hideNotice).toHaveBeenCalledTimes(1);
    download.mockResolvedValue(true);
    await editor.download(file.path, true);
    expect(notice).toHaveBeenLastCalledWith("Downloaded " + file.path);
    expect(hideNotice).toHaveBeenCalledTimes(2);
  },
);
