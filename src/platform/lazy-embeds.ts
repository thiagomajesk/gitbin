import { MarkdownView, type Plugin } from "obsidian";

const embedSelector = ".internal-embed[src]";
function containsEmbed(node: Node): boolean {
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  const element = node as Element;
  return element.matches(embedSelector) || element.querySelector(embedSelector) !== null;
}

export class LazyEmbeds {
  private readonly visible = new Map<Element, string>();
  private readonly intersecting = new Set<Element>();
  private readonly observed = new Set<Element>();
  private disposed = false;
  private attempted = new WeakMap<Element, string>();
  private scheduled = false;
  private readonly intersection = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        this.intersecting.add(entry.target);
        this.inspect(entry.target);
      } else {
        this.intersecting.delete(entry.target);
        this.visible.delete(entry.target);
      }
    }
  });
  constructor(
    private readonly plugin: Plugin,
    private readonly status: (path: string) => string | null,
    private readonly download: (path: string) => Promise<void>,
  ) {}

  install(): void {
    const observer = new MutationObserver((records) => {
      if (
        records.some((record) => [...record.addedNodes, ...record.removedNodes].some(containsEmbed))
      )
        this.scan();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    this.plugin.registerEvent(this.plugin.app.workspace.on("layout-change", () => this.scan()));
    this.plugin.registerEvent(this.plugin.app.metadataCache.on("resolved", () => this.refresh()));
    this.plugin.registerDomEvent(window, "online", () => {
      this.attempted = new WeakMap();
      this.refresh();
    });
    this.plugin.register(() => {
      this.disposed = true;
      observer.disconnect();
      this.intersection.disconnect();
      this.visible.clear();
      this.intersecting.clear();
      this.observed.clear();
    });
    this.scan();
  }
  active(path: string): boolean {
    return [...this.visible.values()].includes(path);
  }
  scan(): void {
    if (this.scheduled || this.disposed) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (this.disposed) return;
      for (const element of this.observed) {
        if (element.isConnected) continue;
        this.intersection.unobserve(element);
        this.observed.delete(element);
        this.visible.delete(element);
        this.intersecting.delete(element);
      }
      this.plugin.app.workspace.iterateAllLeaves((leaf) => {
        if (!(leaf.view instanceof MarkdownView)) return;
        for (const element of leaf.view.containerEl.querySelectorAll(embedSelector)) {
          if (this.observed.has(element)) continue;
          this.observed.add(element);
          this.intersection.observe(element);
        }
      });
    });
  }
  private inspect(element: Element): void {
    const link = element.getAttribute("src")?.split("#")[0];
    if (!link) return;
    this.plugin.app.workspace.iterateAllLeaves((leaf) => {
      if (!(leaf.view instanceof MarkdownView) || !leaf.view.containerEl.contains(element)) return;
      const file = this.resolve(link, leaf.view);
      if (!file) return;
      this.visible.set(element, file.path);
      const message = this.status(file.path);
      if (!navigator.onLine || !message || this.attempted.get(element) === message) return;
      this.attempted.set(element, message);
      void this.download(file.path).then(() => {
        if (this.status(file.path)) return;
        if (leaf.view instanceof MarkdownView) leaf.view.previewMode.rerender(true);
      });
    });
  }
  private resolve(link: string, view: MarkdownView) {
    return (
      this.plugin.app.metadataCache.getFirstLinkpathDest(link, view.file?.path ?? "") ??
      this.plugin.app.vault.getFileByPath(link)
    );
  }
  refresh(): void {
    for (const element of this.intersecting) {
      if (element.isConnected) this.inspect(element);
      else {
        this.intersecting.delete(element);
        this.visible.delete(element);
      }
    }
    this.scan();
  }
}
