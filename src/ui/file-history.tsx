import {
  DEFAULT_VIRTUAL_FILE_METRICS,
  type DiffFileInput,
  type FileContents,
  parseDiffFromFile,
  registerCustomCSSVariableTheme,
} from "@pierre/diffs";
import { MultiFileDiff, useVirtualizer, Virtualizer } from "@pierre/diffs/react";
import { FileText, FoldVertical, GitMerge, HardDrive, Server, UnfoldVertical } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FileChange, FileSnapshot } from "../core/history";
import { Button } from "./controls";
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

function diffFile(file: FileSnapshot | null): FileContents | null {
  return file?.path && file.text !== null ? { name: file.path, contents: file.text } : null;
}

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
  files,
  heading,
  title,
}: {
  readonly files: DiffFileInput;
  readonly heading: ReactNode;
  readonly title: string;
}) {
  const viewerId = useId();
  const { root, measure } = usePreviewBoundary();
  const [expanded, setExpanded] = useState(false);
  const large = useMemo(() => {
    const diff = parseDiffFromFile(files.oldFile, files.newFile);
    return diff.hunks.reduce((total, hunk) => total + hunk.unifiedLineCount, 0) > 50;
  }, [files.oldFile, files.newFile]);
  const content = <DiffContent files={files} measure={measure} />;
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
}: {
  readonly baseline: FileSnapshot | null;
  readonly file: FileSnapshot | null;
  readonly title: "Local" | "Remote" | "Final";
}) {
  const labelId = useId();
  const Icon = { Local: HardDrive, Remote: Server, Final: GitMerge }[title];
  const oldFile = diffFile(baseline);
  const newFile = diffFile(file);
  const files: DiffFileInput | null = oldFile
    ? { oldFile, newFile }
    : newFile
      ? { oldFile: null, newFile }
      : null;
  const heading = (
    <h4 id={labelId}>
      <Icon size={16} aria-hidden="true" />
      {title}
    </h4>
  );
  return (
    <section className="gitbin-diff-panel" aria-labelledby={labelId}>
      {files && oldFile?.contents !== newFile?.contents ? (
        <DiffPreview files={files} heading={heading} title={title} />
      ) : (
        <>
          {heading}
          <div className="gitbin-diff-viewer" />
        </>
      )}
    </section>
  );
}

function comparisonSummary(change: FileChange): string | null {
  const snapshots = [change.baseline, change.local, change.incoming, change.result];
  if (snapshots.some((file) => file?.binary)) return "Binary file. No preview available.";
  const baselineHash = change.baseline?.path ? change.baseline.hash : null;
  if (snapshots.every((file) => (file?.path ? file.hash : null) === baselineHash))
    return change.baseline?.path !== change.result.path
      ? "File moved, contents unchanged."
      : "Contents unchanged.";
  if (snapshots.some((file) => file?.text)) return null;
  return change.result.path ? "Empty file added." : "Empty file removed.";
}

function changeCounts(change: FileChange) {
  const oldFile = diffFile(change.baseline);
  const newFile = diffFile(change.result);
  if (!oldFile && !newFile) return null;
  const diff = parseDiffFromFile(oldFile, newFile);
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

function DiffCounts({ change, show }: { readonly change: FileChange; readonly show: boolean }) {
  const countLabelId = useId();
  const counts = useMemo(() => (show ? changeCounts(change) : null), [change, show]);
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
  showCounts,
}: {
  readonly change: FileChange;
  readonly labelId: string;
  readonly showCounts: boolean;
}) {
  const name = change.result.path ?? change.baseline?.path ?? "Deleted file";
  const moved = change.baseline?.path && change.result.path && change.baseline.path !== name;
  const heading = moved ? `${change.baseline?.path} → ${name}` : name;
  return (
    <header className="gitbin-diff-file-header">
      <FileText size={18} aria-hidden="true" />
      <h3 id={labelId}>{heading}</h3>
      <DiffCounts change={change} show={showCounts} />
    </header>
  );
}

function DiffBlock({ change, labelId }: { readonly change: FileChange; readonly labelId: string }) {
  const summary = comparisonSummary(change);
  const identical = [change.local, change.incoming].every(
    (file) => file?.path === change.result.path && file?.text === change.result.text,
  );
  return (
    <>
      <DiffFileHeader change={change} labelId={labelId} showCounts={summary === null} />
      <div className="gitbin-diff-file-body">
        {summary ? (
          <p className="gitbin-hint">{summary}</p>
        ) : (
          <>
            {!identical && (
              <div className="gitbin-diff-sources">
                <VersionDiff title="Local" baseline={change.baseline} file={change.local} />
                <VersionDiff title="Remote" baseline={change.baseline} file={change.incoming} />
              </div>
            )}
            <VersionDiff title="Final" baseline={change.baseline} file={change.result} />
          </>
        )}
      </div>
    </>
  );
}

function SyncDiffContent({ selection }: { readonly selection: HistorySelection }) {
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
              <DiffBlock change={change} labelId={labelId + change.result.id} />
            </section>
          );
        })}
      </div>
    </section>
  );
}

export function FileHistory({ selection }: { readonly selection: HistorySelection }) {
  return (
    <Virtualizer
      config={virtualizerConfig}
      className="gitbin-diff-scroll"
      contentClassName="gitbin-diff-scroll-content"
    >
      <SyncDiffContent selection={selection} />
    </Virtualizer>
  );
}

function DiffContent({
  files,
  measure,
}: {
  readonly files: DiffFileInput;
  readonly measure: () => void;
}) {
  return (
    <MultiFileDiff
      {...files}
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
