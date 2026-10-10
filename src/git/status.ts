import type { Registration } from "../core/protocol";
export interface VaultStatus {
  readonly vault: Registration;
  readonly latest: string | null;
  readonly applied: string | null;
  readonly changed: boolean | null;
  readonly connected: boolean;
}
