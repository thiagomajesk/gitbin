// @vitest-environment jsdom
import { FileView, type Plugin, type TFile } from "obsidian";
import { afterEach, expect, it, vi } from "vitest";
import { LazyDownloadViews } from "../src/platform/lazy-download-views";

vi.mock("obsidian", () => ({
  FileView: class {
    onLoadFile = vi.fn(async (_file: TFile) => {});
    containerEl = document.createElement("div");
    contentEl = this.containerEl;
    file = { path: "Note.md", name: "Note.md", extension: "md" };
  },
}));
type Options = { cls?: string; text?: string; attr?: Record<string, string> };
function create(this: HTMLElement, tag: string, options: Options = {}) {
  const el = document.createElement(tag);
  if (options.cls) el.className = options.cls;
  if (options.text) el.textContent = options.text;
  for (const [key, value] of Object.entries(options.attr ?? {})) el.setAttribute(key, value);
  this.append(el);
  return el;
}
Object.assign(HTMLElement.prototype, {
  createEl: create,
  createDiv(this: HTMLElement, options: Options) {
    return create.call(this, "div", options);
  },
  addClass(this: HTMLElement, name: string) {
    this.classList.add(name);
  },
  removeClass(this: HTMLElement, name: string) {
    this.classList.remove(name);
  },
});
afterEach(() => document.body.replaceChildren());
it("shows offline guidance without a retry control", () => {
  const connection = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  try {
    const { view, state, views } = fixture();
    state.busy = false;
    views.refresh();
    const button = view.contentEl.querySelector("button");
    expect(button).toBeNull();
    expect(view.contentEl.textContent).toContain("Connect to the internet");
    connection.mockReturnValue(true);
    views.refresh();
    expect(view.contentEl.querySelector("button")).toBeNull();
  } finally {
    connection.mockRestore();
  }
});
it("shows the storage warning without progress or a retry control", () => {
  const { view, state, views } = fixture();
  views.refresh();
  state.busy = false;
  state.message =
    "Not enough space to download this file. Increase the local storage limit in Settings, then try again.";
  views.refresh();
  expect(view.contentEl.querySelector("p")?.textContent).toBe(state.message);
  expect(view.contentEl.querySelector('[role="progressbar"]')).toBeNull();
  expect(view.containerEl.classList.contains("gitbin-download-pending")).toBe(true);
  expect(view.contentEl.querySelector("button")).toBeNull();
  expect(views.shows("Note.md")).toBe(true);
  expect(views.shows("Other.md")).toBe(false);
});
function fixture() {
  const view = new (FileView as unknown as new () => FileView)();
  document.body.append(view.containerEl);
  const state = { message: "Not downloaded", busy: true };
  const cleanup: (() => void)[] = [];
  const plugin = {
    register: (fn: () => void) => cleanup.push(fn),
    app: {
      workspace: { iterateAllLeaves: (fn: (leaf: { view: FileView }) => void) => fn({ view }) },
      vault: { getResourcePath: () => "app://downloaded-image" },
    },
  } as unknown as Plugin;
  const actions = {
    status: () => state.message,
    download: async () => true,
  };
  const views = new LazyDownloadViews(plugin, actions, () => state.busy);
  return { view, state, views, cleanup };
}
it("preserves the progress and message during unchanged refreshes", () => {
  const { view, state, views } = fixture();
  views.refresh();
  const progress = view.contentEl.querySelector('[role="progressbar"]');
  for (let i = 0; i < 5; i++) views.refresh();
  expect(view.contentEl.querySelector('[role="progressbar"]')).toBe(progress);
  state.busy = false;
  state.message = "Offline. Try again.";
  views.refresh();
  const panel = view.contentEl.querySelector(".gitbin-download-panel");
  views.refresh();
  expect(view.contentEl.querySelector(".gitbin-download-panel")).toBe(panel);
  expect(view.contentEl.querySelector("button")).toBeNull();
});
it("updates switched files, recreates removed panels, and clears them after completion", () => {
  const { view, state, views, cleanup } = fixture();
  views.refresh();
  view.file = { path: "Photo.bmp", name: "Photo.bmp", extension: "bmp" } as TFile;
  views.refresh();
  expect(view.contentEl.querySelector("strong")?.textContent).toBe("Photo.bmp");
  view.contentEl.querySelector(".gitbin-download-panel")?.remove();
  views.refresh();
  expect(view.contentEl.querySelector('[role="progressbar"]')).not.toBeNull();
  const image = document.createElement("img");
  view.contentEl.append(image);
  state.message = "";
  views.refresh();
  expect(view.onLoadFile).toHaveBeenCalledWith(view.file);
  expect(view.contentEl.querySelector(".gitbin-download-panel")).toBeNull();
  state.message = "Waiting";
  views.refresh();
  for (const fn of cleanup) fn();
  expect(view.containerEl.classList.contains("gitbin-download-pending")).toBe(false);
  expect(view.contentEl.querySelector(".gitbin-download-panel")).toBeNull();
});

it.each(["pdf", "gif", "svg", "mp3", "custom"])(
  "reloads the registered view for %s without type-specific rendering",
  (extension) => {
    const { view, state, views } = fixture();
    view.file = { path: "File." + extension, name: "File." + extension, extension } as TFile;
    views.refresh();
    state.message = "";
    views.refresh();
    expect(view.onLoadFile).toHaveBeenCalledWith(view.file);
    expect(view.containerEl.querySelector(".gitbin-download-panel")).toBeNull();
  },
);
