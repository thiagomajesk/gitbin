import { memo, useDeferredValue, useId, useMemo, useState, type ReactNode } from "react";
import { Eye, FileText, SquareDot, SquareMinus, SquarePlus } from "lucide-react";
import type { FileChange, HistoryEntry } from "../core/history";
import { Button, Link } from "./controls";
import { Primitive } from "@radix-ui/react-primitive";

export type HistorySelection = { readonly entry: HistoryEntry; readonly change: FileChange | null };
function fileName(change: FileChange): string {
  return change.result.path ?? change.baseline?.path ?? "Deleted file";
}
const fileOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
export function orderedChanges(changes: ReadonlyArray<FileChange>): FileChange[] {
  return [...changes].sort((a, b) => fileOrder.compare(fileName(a), fileName(b)));
}
function HighlightedName({
  name,
  pattern,
}: {
  readonly name: string;
  readonly pattern: RegExp | null;
}) {
  if (!pattern) return name;
  const parts: ReactNode[] = [];
  let offset = 0;
  for (const match of name.matchAll(pattern)) {
    parts.push(name.slice(offset, match.index));
    parts.push(<mark key={`${name}:${match.index}`}>{match[0]}</mark>);
    offset = match.index + match[0].length;
  }
  parts.push(name.slice(offset));
  return parts;
}
function FileState({
  entry,
  change,
}: {
  readonly entry: HistoryEntry;
  readonly change: FileChange;
}) {
  const labelId = useId();
  if (change.result.path === null)
    return (
      <span className="gitbin-file-state is-removed" role="img" aria-labelledby={labelId}>
        <span id={labelId} className="gitbin:sr-only">
          Removed
        </span>
        <SquareMinus size={14} aria-hidden="true" />
      </span>
    );
  if (!entry.baselineKnown || !change.baseline?.path)
    return (
      <span className="gitbin-file-state is-added" role="img" aria-labelledby={labelId}>
        <span id={labelId} className="gitbin:sr-only">
          Added
        </span>
        <SquarePlus size={14} aria-hidden="true" />
      </span>
    );
  return (
    <span className="gitbin-file-state is-changed" role="img" aria-labelledby={labelId}>
      <span id={labelId} className="gitbin:sr-only">
        Changed
      </span>
      <SquareDot size={14} aria-hidden="true" />
    </span>
  );
}
const TimelineEntry = memo(function TimelineEntry({
  entry,
  openFile,
  pattern,
}: {
  readonly entry: HistoryEntry;
  readonly openFile: (selection: HistorySelection) => void;
  readonly pattern: RegExp | null;
}) {
  const date = new Date(entry.at);
  const previewLabelId = useId();
  const count = entry.changes.length;
  const changes = useMemo(() => orderedChanges(entry.changes), [entry.changes]);
  return (
    <li className="gitbin-timeline-entry">
      <header className="gitbin-sync-time">
        <h4>
          {count} {count === 1 ? "file" : "files"} synced
        </h4>
        <div className="gitbin-sync-actions">
          <time dateTime={date.toISOString()}>
            {date.toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </time>
          <Button
            type="button"
            className="clickable-icon gitbin-sync-preview"
            aria-labelledby={previewLabelId}
            onClick={() => openFile({ entry, change: null })}
          >
            <Eye size={18} aria-hidden="true" />
            <span id={previewLabelId} className="gitbin:sr-only">
              View sync changes
            </span>
          </Button>
        </div>
      </header>
      <ul className="gitbin-history-files">
        {changes.map((change) => (
          <li key={change.result.id}>
            <Link
              href={"#gitbin-history-" + entry.id + "-" + change.result.id}
              onClick={(event) => {
                event.preventDefault();
                openFile({ entry, change });
              }}
            >
              <FileText size={16} aria-hidden="true" />
              <HighlightedName name={fileName(change)} pattern={pattern} />
            </Link>
            <FileState entry={entry} change={change} />
          </li>
        ))}
      </ul>
    </li>
  );
});
function historyDays(entries: ReadonlyArray<HistoryEntry>) {
  const days = new Map<string, { at: number; entries: HistoryEntry[] }>();
  for (const entry of entries) {
    const key = new Date(entry.at).toDateString();
    const day = days.get(key);
    if (day) day.entries.push(entry);
    else days.set(key, { at: entry.at, entries: [entry] });
  }
  return Array.from(days.values());
}
export function SyncHistory({
  entries,
  warning,
  openFile,
}: {
  readonly entries: ReadonlyArray<HistoryEntry>;
  readonly warning: string | null;
  readonly openFile: (selection: HistorySelection) => void;
}) {
  const headingId = useId();
  const [search, setSearch] = useState("");
  const query = useDeferredValue(search.trim());
  const pattern = useMemo(
    () => (query ? new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi") : null),
    [query],
  );
  const days = useMemo(() => historyDays(entries), [entries]);
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="gitbin-history-heading">
        Sync history
      </h2>
      <Primitive.input
        type="search"
        aria-label="Search sync history"
        placeholder="Search files"
        className="gitbin-history-search"
        value={search}
        onInput={(event) => setSearch(event.currentTarget.value)}
      />
      {warning ? (
        <p role="status" className="gitbin-hint">
          {warning}
        </p>
      ) : null}
      {!entries.length ? (
        <p className="gitbin-hint">
          No sync history yet. Changes will appear here after files change and sync.
        </p>
      ) : null}
      <div className="gitbin-timeline">
        {days.map((day) => (
          <section key={new Date(day.at).toDateString()} className="gitbin-timeline-day">
            <h3 className="gitbin-day-marker">
              <time dateTime={new Date(day.at).toISOString()}>
                {new Date(day.at).toLocaleDateString(undefined, { dateStyle: "long" })}
              </time>
            </h3>
            <ol className="gitbin-day-entries">
              {day.entries.map((entry) => (
                <TimelineEntry key={entry.id} entry={entry} openFile={openFile} pattern={pattern} />
              ))}
            </ol>
          </section>
        ))}
      </div>
    </section>
  );
}
