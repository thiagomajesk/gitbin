import { Logger, Schema } from "effect";
import type { DataAdapter } from "obsidian";
import { type ActivityEntry, ActivityEvent, sanitizeActivity } from "../core/activity";
import { activityLevel } from "../core/activity-level";
import type { UiStore } from "../ui/store";

const Entries = Schema.Array(
  Schema.Struct({
    id: Schema.String,
    time: Schema.Number,
    level: Schema.Literals(["info", "success", "warning", "error"]),
    message: Schema.String,
    details: Schema.optionalKey(Schema.String),
  }),
);
export class ActivityLog {
  private entries: readonly ActivityEntry[] = [];
  private dirty = false;
  private saving: Promise<void> = Promise.resolve();
  readonly logger = Logger.make<unknown, void>(({ message, logLevel }) => {
    if (!Array.isArray(message)) return;
    for (const event of message) {
      if (!(event instanceof ActivityEvent)) continue;
      this.record(event.message, activityLevel(logLevel), event.details);
      this.store.update({ phase: this.sanitize(event.message) });
    }
  });
  constructor(
    private readonly adapter: Pick<DataAdapter, "exists" | "read" | "write">,
    private readonly path: string,
    private readonly store: UiStore,
    private readonly secrets: () => readonly string[] = () => [],
  ) {}
  async load(): Promise<void> {
    try {
      if (!(await this.adapter.exists(this.path))) return;
      const raw: unknown = JSON.parse(await this.adapter.read(this.path));
      this.entries = Schema.decodeUnknownSync(Entries)(raw)
        .slice(-200)
        .map((entry) => ({
          ...entry,
          message: this.logMessage(entry.message),
          details: this.sanitize(entry.details ?? ""),
        }));
      this.changed();
    } catch {
      this.record(
        "Previous sync activity could not be read. New activity will still be recorded.",
        "error",
      );
    }
  }
  sanitize(message: string): string {
    try {
      return sanitizeActivity(message, this.secrets());
    } catch {
      return "Activity details unavailable because credentials could not be checked.";
    }
  }
  private logMessage(message: string): string {
    return this.sanitize(message).replace(/(?:…|\.{3})$/, "");
  }
  record(message: string, level: ActivityEntry["level"] = "info", details = ""): void {
    const [title, ...causes] = message.split(" — ");
    const entry: ActivityEntry = {
      id: crypto.randomUUID(),
      time: Date.now(),
      level,
      message: this.logMessage(title ?? message),
      details: this.sanitize([details, ...causes].filter(Boolean).join(" — ")),
    };
    this.entries = [...this.entries, entry].slice(-200);
    this.changed();
  }
  private changed(): void {
    this.dirty = true;
    this.store.update({ activity: this.entries });
  }
  flush(): Promise<void> {
    if (!this.dirty) return this.saving;
    this.dirty = false;
    const serialized = JSON.stringify(this.entries);
    this.saving = this.saving
      .then(() => this.adapter.write(this.path, serialized))
      .then(
        () => {
          this.store.update({ activityWarning: null });
        },
        () => {
          this.dirty = true;
          this.store.update({
            activityWarning:
              "Recent activity could not be saved. It is available until Obsidian closes.",
          });
        },
      );
    return this.saving;
  }
}
