import type { Authentication } from "../auth/credentials";
import type { Config, SyncPreferences } from "../core/config";
import type { Registration } from "../core/protocol";
import type { SyncActions } from "./store";
export interface RepositoryInspection {
  readonly vaults: ReadonlyArray<Registration>;
}
export interface SetupActions extends SyncActions {
  readonly vaultName: string;
  scanToSync(): void;
  consolidate(): void;
  reinitialize(): void;
  saveSyncPreferences(preferences: SyncPreferences): Promise<boolean>;
  savedAuthentication(): Authentication | null;
  disconnect(): Promise<boolean>;
  inspect(connection: Authentication): Promise<RepositoryInspection | null>;
  finish(config: Config, authentication: Authentication): Promise<boolean>;
}
