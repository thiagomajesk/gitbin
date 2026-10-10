// @vitest-environment jsdom

import { MarkdownView, type Plugin } from "obsidian";
import { afterEach, expect, it, vi } from "vitest";
import { LazyEmbeds } from "../src/platform/lazy-embeds";

vi.mock("obsidian", () => ({
  MarkdownView: class {
    containerEl = document.createElement("div");
    file = { path: "Note.md" };
    previewMode = { rerender: vi.fn() };
  },
}));
afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
it.each(["pdf", "gif", "svg", "mp3", "custom"])(
  "downloads visible %s embeds and retries after reopening",
  async (extension) => {
    let intersect: IntersectionObserverCallback = () => {};
    const unobserve = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          intersect = callback;
        }
        observe() {}
        unobserve = unobserve;
        disconnect() {}
      },
    );
    const view = new (MarkdownView as unknown as new () => MarkdownView)();
    document.body.append(view.containerEl);
    const file = { path: "Attachment." + extension, extension };
    const plugin = {
      app: {
        workspace: {
          iterateAllLeaves: (fn: (leaf: { view: MarkdownView }) => void) => fn({ view }),
        },
        metadataCache: { getFirstLinkpathDest: () => file },
      },
    } as unknown as Plugin;
    const download = vi.fn(async () => {});
    const embeds = new LazyEmbeds(plugin, () => "Not downloaded", download);
    for (let attempt = 0; attempt < 2; attempt++) {
      const embed = document.createElement("span");
      embed.className = "internal-embed";
      embed.setAttribute("src", file.path);
      view.containerEl.replaceChildren(embed);
      embeds.scan();
      await Promise.resolve();
      const target = view.containerEl.firstElementChild;
      if (!target) throw new Error("Missing embed");
      intersect(
        [{ target, isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
      await Promise.resolve();
    }
    expect(download).toHaveBeenCalledTimes(2);
    expect(download).toHaveBeenCalledWith(file.path);
    expect(unobserve).toHaveBeenCalledTimes(1);
    const offline = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const target = view.containerEl.firstElementChild as Element;
    intersect(
      [{ target, isIntersecting: false } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
    expect(embeds.active(file.path)).toBe(false);
    intersect(
      [{ target, isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
    expect(embeds.active(file.path)).toBe(true);
    expect(download).toHaveBeenCalledTimes(2);
    offline.mockRestore();
  },
);

it("ignores unrelated DOM changes and cancels queued scans after unloading", async () => {
  let mutations: MutationCallback = () => {};
  vi.stubGlobal(
    "MutationObserver",
    class {
      constructor(callback: MutationCallback) {
        mutations = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const dispose: Array<() => void> = [];
  const iterateAllLeaves = vi.fn();
  const plugin = {
    register: (callback: () => void) => dispose.push(callback),
    registerEvent: vi.fn(),
    registerDomEvent: vi.fn(),
    app: { workspace: { on: vi.fn(), iterateAllLeaves }, metadataCache: { on: vi.fn() } },
  } as unknown as Plugin;
  const embeds = new LazyEmbeds(
    plugin,
    () => null,
    async () => {},
  );
  embeds.install();
  await Promise.resolve();
  iterateAllLeaves.mockClear();
  const record = {
    addedNodes: [document.createElement("div")],
    removedNodes: [],
  } as unknown as MutationRecord;
  mutations([record], {} as MutationObserver);
  await Promise.resolve();
  expect(iterateAllLeaves).not.toHaveBeenCalled();
  embeds.scan();
  for (const callback of dispose) callback();
  await Promise.resolve();
  expect(iterateAllLeaves).not.toHaveBeenCalled();
});
