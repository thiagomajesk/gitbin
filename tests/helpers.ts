import { Effect } from "effect";
import { SyncError } from "../src/core/errors";
import type { LocalVault } from "../src/core/ports";
import type { Journal } from "../src/core/protocol";
import type { HistoryState } from "../src/core/history";
import { type FileContent, textContent, contentEqual } from "../src/core/content";

export class MemoryVault implements LocalVault {
  readonly files = new Map<string, string | FileContent>();
  journal: Journal | null = null;
  history: HistoryState | null = null;
  loadHistory = () => Effect.succeed(structuredClone(this.history));
  saveHistory = (history: HistoryState): Effect.Effect<void, SyncError> =>
    Effect.sync(() => {
      this.history = structuredClone(history);
    });
  writes = 0;
  failAfter: number | null = null;
  scan = () =>
    Effect.succeed(
      new Map(
        Array.from(this.files, ([path, value]) => [
          path,
          typeof value === "string" ? textContent(value) : value,
        ]),
      ),
    );
  read = (path: string) => {
    const value = this.files.get(path);
    return Effect.succeed(typeof value === "string" ? textContent(value) : (value ?? null));
  };
  load = () => Effect.succeed(structuredClone(this.journal));
  save = (journal: Journal) =>
    Effect.sync(() => {
      this.journal = structuredClone(journal);
    });
  write = (path: string, expected: FileContent | null, next: FileContent | null) =>
    Effect.gen({ self: this }, function* () {
      if (this.failAfter !== null && this.writes >= this.failAfter)
        return yield* new SyncError({ message: "Simulated interruption" });
      if (!contentEqual(yield* this.read(path), expected))
        return yield* new SyncError({ message: "Concurrent local edit" });
      if (next === null) this.files.delete(path);
      else this.files.set(path, next.type === "text" ? next.value : next);
      this.writes++;
    });
}
