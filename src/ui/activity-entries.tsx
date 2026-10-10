import { CircleCheck, CircleX, Info, TriangleAlert } from "lucide-react";
import type { ActivityEntry } from "../core/activity";

const levels = {
  info: { icon: Info, label: "Info" },
  success: { icon: CircleCheck, label: "Success" },
  warning: { icon: TriangleAlert, label: "Warning" },
  error: { icon: CircleX, label: "Error" },
};
function Message({ entry }: { readonly entry: ActivityEntry }) {
  const { icon: Icon, label } = levels[entry.level];
  return (
    <div className="gitbin-log-message">
      <div className="gitbin-log-line">
        <span
          className={"gitbin-log-level gitbin-log-" + entry.level}
          role="img"
          aria-label={label}
          title={label}
        >
          <Icon aria-hidden="true" className="svg-icon" />
        </span>
        <span>{entry.message}</span>
      </div>
    </div>
  );
}
export function ActivityEntries({ entries }: { readonly entries: readonly ActivityEntry[] }) {
  return (
    <ol className="gitbin-activity-log">
      {entries.map((entry) => (
        <li key={entry.id} className="gitbin-log-entry">
          <time>{new Date(entry.time).toLocaleString()}</time>
          <Message entry={entry} />
        </li>
      ))}
    </ol>
  );
}
