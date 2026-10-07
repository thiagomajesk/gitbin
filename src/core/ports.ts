import type { Effect } from "effect";
import type { SyncError } from "./errors";
import type { Journal, Registration } from "./protocol";
import type { HistoryState } from "./history";
import type { FileContent } from "./content";

export interface LocalVault {
  scan(): Effect.Effect<ReadonlyMap<string, FileContent>, SyncError>;
  read(path: string): Effect.Effect<FileContent | null, SyncError>;
  write(
    path: string,
    expected: FileContent | null,
    next: FileContent | null,
  ): Effect.Effect<void, SyncError>;
  load(): Effect.Effect<unknown, SyncError>;
  save(journal: Journal): Effect.Effect<void, SyncError>;
  loadHistory(): Effect.Effect<unknown, SyncError>;
  saveHistory(history: HistoryState): Effect.Effect<void, SyncError>;
}

export interface RemoteSnapshot {
  readonly revision: string | null;
  readonly vaults: ReadonlyArray<Registration>;
  readonly states: ReadonlyMap<string, Uint8Array>;
  readonly files: ReadonlyMap<string, FileContent>;
}

export interface Publication {
  readonly vault: Registration;
  readonly states: ReadonlyMap<string, Uint8Array>;
  readonly files: ReadonlyMap<string, FileContent>;
}

export interface GitRemote {
  read(vault: Registration): Effect.Effect<RemoteSnapshot, SyncError>;
  publish(
    base: RemoteSnapshot,
    publication: Publication,
  ): Effect.Effect<{ readonly published: boolean; readonly revision: string | null }, SyncError>;
}

export interface SyncResult {
  readonly historyWarning: string | null;
  readonly revision: string | null;
  readonly published: boolean;
}
