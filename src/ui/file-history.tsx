import {
  DEFAULT_VIRTUAL_FILE_METRICS,
  type FileDiffMetadata,
  parseDiffFromFile,
  registerCustomCSSVariableTheme,
} from "@pierre/diffs";
import { FileDiff, useVirtualizer, Virtualizer } from "@pierre/diffs/react";
import {
  FileText,
  FoldVertical,
  GitMerge,
  HardDrive,
  RefreshCw,
  Server,
  UnfoldVertical,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { FileChange, FileSnapshot } from "../core/history";
import { Button } from "./controls";
import { comparisonSummary, diffFile, previewMatches } from "./history-decisions";
import { IconButton } from "./icon-button";
import { type HistorySelection, orderedChanges } from "./sync-history";

registerCustomCSSVariableTheme("gitbin-obsidian", {
  foreground: "var(--text-normal)",
  background: "var(--background-primary)",
  "token-comment": "var(--code-comment)",
  "token-constant": "var(--code-value)",
  "token-keyword": "var(--code-keyword)",
  "token-parameter": "var(--code-normal)",
  "token-function": "var(--code-function)",
  "token-string": "var(--code-string)",
  "token-string-expression": "var(--code-string)",
  "token-punctuation": "var(--code-punctuation)",
  "token-link": "var(--link-color)",
  "token-inserted": "var(--color-green)",
  "token-deleted": "var(--color-red)",
  "token-changed": "var(--color-orange)",
});
const diffMetrics = { ...DEFAULT_VIRTUAL_FILE_METRICS, diffHeaderHeight: 0 };
const virtualizerConfig = { overscrollSize: 600, intersectionObserverMargin: 1200 };

function alignPreview(root: HTMLDivElement): void {
  const viewport = root.querySelector<HTMLElement>(".gitbin-diff-preview");
  const rows = viewport
    ?.querySelector("diffs-container")
    ?.shadowRoot?.querySelectorAll<HTMLElement>("[data-code] [data-line]");
  if (!viewport || !rows?.length) return;
  const top = viewport.getBoundingClientRect().top;
  let boundary = 0;
  let firstBottom = 0;
  for (const row of rows) {
    const bottom = row.getBoundingClientRect().bottom - top;
    if (!firstBottom) firstBottom = bottom;
    if (bottom <= 360) boundary = Math.max(boundary, bottom);
  }
  const height = boundary || firstBottom;
  if (height > 0) viewport.style.height = `${height}px`;
}

function usePreviewBoundary() {
  const root = useRef<HTMLDivElement>(null);
  const frame = useRef<{ window: Window; id: number } | null>(null);
  const measure = useCallback(() => {
    const ownerWindow = root.current?.ownerDocument.defaultView;
    if (!ownerWindow) return;
    if (frame.current) frame.current.window.cancelAnimationFrame(frame.current.id);
    const id = ownerWindow.requestAnimationFrame(() => {
      frame.current = null;
      if (root.current) alignPreview(root.current);
    });
    frame.current = { window: ownerWindow, id };
  }, []);
  useLayoutEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver(measure);
    observer.observe(root.current);
    return () => {
      observer.disconnect();
      if (frame.current) frame.current.window.cancelAnimationFrame(frame.current.id);
      frame.current = null;
    };
  }, [measure]);
  return { root, measure };
}

function DiffPreview({
  diff,
  heading,
  title,
}: {
  readonly diff: FileDiffMetadata;
  readonly heading: ReactNode;
  readonly title: string;
}) {
  const viewerId = useId();
  const { root, measure } = usePreviewBoundary();
  const [expanded, setExpanded] = useState(false);
  const large = useMemo(() => {
    return diff.hunks.reduce((total, hunk) => total + hunk.unifiedLineCount, 0) > 50;
  }, [diff]);
  const content = <DiffContent diff={diff} measure={measure} />;
  return (
    <>
      <div className="gitbin-diff-label">
        {heading}
        {large && (
          <Button
            type="button"
            className="clickable-icon gitbin-diff-expand"
            aria-label={`${expanded ? "Collapse" : "Expand"} ${title} diff`}
            aria-expanded={expanded}
            aria-controls={viewerId}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? (
              <FoldVertical size={16} aria-hidden="true" />
            ) : (
              <UnfoldVertical size={16} aria-hidden="true" />
            )}
          </Button>
        )}
      </div>
      <div ref={root} id={viewerId} className="gitbin-diff-viewer">
        {large && !expanded ? (
          <Virtualizer config={virtualizerConfig} className="gitbin-diff-preview">
            {content}
          </Virtualizer>
        ) : (
          content
        )}
      </div>
    </>
  );
}

function VersionDiff({
  baseline,
  file,
  title,
  parsed,
}: {
  readonly baseline: FileSnapshot | null;
  readonly file: FileSnapshot | null;
  readonly title: "Local" | "Remote" | "Final";
  readonly parsed?: FileDiffMetadata | null | undefined;
}) {
  const labelId = useId();
  const Icon = { Local: HardDrive, Remote: Server, Final: GitMerge }[title];
  const diff = useMemo(
    () =>
      baseline?.text === file?.text
        ? null
        : parsed === undefined
          ? parseComparison(baseline, file)
          : parsed,
    [baseline, file, parsed],
  );
  const heading = (
    <h4 id={labelId}>
      <Icon size={16} aria-hidden="true" />
      {title}
    </h4>
  );
  return (
    <section className="gitbin-diff-panel" aria-labelledby={labelId}>
      {diff && baseline?.text !== file?.text ? (
        <DiffPreview diff={diff} heading={heading} title={title} />
      ) : (
        <>
          {heading}
          <div className="gitbin-diff-viewer" />
        </>
      )}
    </section>
  );
}

function parseComparison(
  baseline: FileSnapshot | null,
  file: FileSnapshot | null,
): FileDiffMetadata | null {
  const oldFile = diffFile(baseline);
  const newFile = diffFile(file);
  if (!oldFile && !newFile) return null;
  return parseDiffFromFile(oldFile, newFile);
}
function changeCounts(diff: FileDiffMetadata | null) {
  if (!diff) return null;
  let added = 0;
  let removed = 0;
  for (const hunk of diff.hunks) {
    for (const content of hunk.hunkContent) {
      if (content.type === "change") {
        added += content.additions;
        removed += content.deletions;
      }
    }
  }
  return { added, removed };
}

function DiffCounts({ diff }: { readonly diff: FileDiffMetadata | null }) {
  const countLabelId = useId();
  const counts = useMemo(() => changeCounts(diff), [diff]);
  if (!counts) return null;
  return (
    <span className="gitbin-diff-counts" role="img" aria-labelledby={countLabelId}>
      <span id={countLabelId} className="gitbin:sr-only">
        {counts.added} lines added, {counts.removed} lines removed
      </span>
      <span className="gitbin-diff-added" aria-hidden="true">
        +{counts.added}
      </span>
      <span className="gitbin-diff-removed" aria-hidden="true">
        −{counts.removed}
      </span>
    </span>
  );
}

function DiffFileHeader({
  change,
  labelId,
  diff,
  action,
}: {
  readonly change: FileChange;
  readonly labelId: string;
  readonly diff: FileDiffMetadata | null;
  readonly action?: ReactNode;
}) {
  const name = change.result.path ?? change.baseline?.path ?? "Deleted file";
  const moved = change.baseline?.path && change.result.path && change.baseline.path !== name;
  const heading = moved ? `${change.baseline?.path} → ${name}` : name;
  return (
    <header className="gitbin-diff-file-header">
      <FileText size={18} aria-hidden="true" />
      <h3 id={labelId}>{heading}</h3>
      <DiffCounts diff={diff} />
      {action}
    </header>
  );
}

function DiffBlock({ change, labelId }: { readonly change: FileChange; readonly labelId: string }) {
  const summary = comparisonSummary(change);
  const finalDiff = useMemo(
    () => (summary === null ? parseComparison(change.baseline, change.result) : null),
    [change, summary],
  );
  const identical =
    previewMatches(change.local, change.result) && previewMatches(change.incoming, change.result);
  return (
    <>
      <DiffFileHeader change={change} labelId={labelId} diff={finalDiff} />
      <div className="gitbin-diff-file-body">
        {summary ? (
          <p className="gitbin-hint">{summary}</p>
        ) : (
          <>
            {!identical && (
              <div className="gitbin-diff-sources">
                <VersionDiff
                  title="Local"
                  baseline={change.baseline}
                  file={change.local}
                  parsed={previewMatches(change.local, change.result) ? finalDiff : undefined}
                />
                <VersionDiff
                  title="Remote"
                  baseline={change.baseline}
                  file={change.incoming}
                  parsed={previewMatches(change.incoming, change.result) ? finalDiff : undefined}
                />
              </div>
            )}
            <VersionDiff
              title="Final"
              baseline={change.baseline}
              file={change.result}
              parsed={finalDiff}
            />
          </>
        )}
      </div>
    </>
  );
}

export interface HistoryProps {
  readonly selection: HistorySelection;
  readonly load?: ((change: FileChange) => Promise<FileChange>) | undefined;
  readonly onDemand?: boolean;
  readonly cached?: ((change: FileChange) => Promise<boolean>) | undefined;
}

function subscribeConnection(changed: () => void): () => void {
  window.addEventListener("online", changed);
  window.addEventListener("offline", changed);
  return () => {
    window.removeEventListener("online", changed);
    window.removeEventListener("offline", changed);
  };
}

function useCachedComparison(
  change: FileChange,
  cached: HistoryProps["cached"],
  online: boolean,
): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let active = true;
    setAvailable(false);
    if (online) return;
    void cached?.(change)
      .then((value) => {
        if (active) setAvailable(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [change, cached, online]);
  return available;
}

function LazyDiffBlock({
  change,
  labelId,
  load,
  onDemand,
  cached,
}: {
  readonly change: FileChange;
  readonly labelId: string;
  readonly load?: ((change: FileChange) => Promise<FileChange>) | undefined;
  readonly onDemand: boolean;
  readonly cached?: ((change: FileChange) => Promise<boolean>) | undefined;
}) {
  const online = useSyncExternalStore(subscribeConnection, () => navigator.onLine);
  const availableOffline = useCachedComparison(change, cached, online);
  const [loaded, setLoaded] = useState<FileChange | null>(null);
  const [busy, setBusy] = useState(false);
  const needsContent = [change.baseline, change.local, change.incoming, change.result].some(
    (file) => file?.content && !file.binary && file.path !== null && file.text === null,
  );
  if (loaded || !needsContent || !load)
    return <DiffBlock change={loaded ?? change} labelId={labelId} />;
  const download = async () => {
    if ((!navigator.onLine && !availableOffline) || busy) return;
    setBusy(true);
    try {
      setLoaded(await load(change));
    } catch {
      // The load action reports failures through Obsidian's notification.
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <DiffFileHeader
        change={change}
        labelId={labelId}
        diff={null}
        action={
          <PreviewRefresh online={online || availableOffline} busy={busy} download={download} />
        }
      />
      <div className="gitbin-diff-file-body">
        <p className="gitbin-hint">
          {onDemand
            ? "No preview available with on-demand downloads turned on. Download the comparison to see it."
            : "No preview available. Download the comparison to see it."}
          {!online && !availableOffline ? " Connect to the internet to download it." : ""}
        </p>
      </div>
    </>
  );
}

function PreviewRefresh({
  online,
  busy,
  download,
}: {
  readonly online: boolean;
  readonly busy: boolean;
  readonly download: () => Promise<void>;
}) {
  return (
    <IconButton
      label={
        !online
          ? "Connect to download the comparison"
          : busy
            ? "Downloading comparison…"
            : "Download comparison"
      }
      disabled={busy || !online}
      aria-busy={busy}
      onClick={() => void download()}
    >
      <RefreshCw
        size={18}
        aria-hidden="true"
        className={busy ? "gitbin-refresh-spinning" : undefined}
      />
    </IconButton>
  );
}

function SyncDiffContent({ selection, load, onDemand = false, cached }: HistoryProps) {
  const labelId = useId();
  const selectedFile = useRef<HTMLElement>(null);
  const virtualizer = useVirtualizer();
  useLayoutEffect(() => {
    const ownerWindow = selectedFile.current?.ownerDocument.defaultView;
    if (!selection.change || !ownerWindow) return;
    const frame = ownerWindow.requestAnimationFrame(() => {
      if (selectedFile.current && virtualizer)
        virtualizer.scrollTo({ top: virtualizer.getOffsetInScrollContainer(selectedFile.current) });
    });
    return () => ownerWindow.cancelAnimationFrame(frame);
  }, [selection, virtualizer]);
  const { entry } = selection;
  const changes = useMemo(() => orderedChanges(entry.changes), [entry.changes]);
  return (
    <section aria-labelledby={labelId} className="gitbin-file-history">
      <span id={labelId} className="gitbin:sr-only">
        Sync changes
      </span>
      <div className="gitbin-sync-diffs">
        {changes.map((change) => {
          return (
            <section
              key={change.result.id}
              ref={change.result.id === selection.change?.result.id ? selectedFile : undefined}
              className={
                change.result.id === selection.change?.result.id
                  ? "gitbin-sync-file is-selected"
                  : "gitbin-sync-file"
              }
              aria-labelledby={labelId + change.result.id}
              data-file-id={change.result.id}
            >
              <LazyDiffBlock
                change={change}
                labelId={labelId + change.result.id}
                load={load}
                onDemand={onDemand}
                cached={cached}
              />
            </section>
          );
        })}
      </div>
    </section>
  );
}

export function FileHistory({ selection, load, onDemand = false, cached }: HistoryProps) {
  return (
    <Virtualizer
      config={virtualizerConfig}
      className="gitbin-diff-scroll"
      contentClassName="gitbin-diff-scroll-content"
    >
      <SyncDiffContent selection={selection} load={load} onDemand={onDemand} cached={cached} />
    </Virtualizer>
  );
}

function DiffContent({
  diff,
  measure,
}: {
  readonly diff: FileDiffMetadata;
  readonly measure: () => void;
}) {
  return (
    <FileDiff
      fileDiff={diff}
      metrics={diffMetrics}
      options={{
        theme: "gitbin-obsidian",
        diffStyle: "unified",
        overflow: "wrap",
        disableFileHeader: true,
        lineDiffType: "word",
        hunkSeparators: "line-info-basic",
        expansionLineCount: 20,
        onPostRender: measure,
      }}
    />
  );
}
