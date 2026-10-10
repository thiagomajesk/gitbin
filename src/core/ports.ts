import type { FileContent } from "./content";
import type { Registration } from "./protocol";

export interface RemoteSnapshot {
  readonly consolidationHash?: string | null;
  readonly blobs?: ReadonlyMap<string, FileContent>;
  readonly revision: string | null;
  readonly vaults: ReadonlyArray<Registration>;
  readonly states: ReadonlyMap<string, Uint8Array>;
  readonly files: ReadonlyMap<string, FileContent>;
}
