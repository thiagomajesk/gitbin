import { Data, Effect } from "effect";

export class SyncError extends Data.TaggedError("SyncError")<{
  readonly message: string;
  readonly code?: "migration-required" | "newer-format" | "invalid-data";
  readonly detail?: string;
  readonly cause?: unknown;
}> {}

export const attempt = <A>(message: string, action: () => A): Effect.Effect<A, SyncError> =>
  Effect.try({ try: action, catch: (cause) => new SyncError({ message, cause }) });

export const io = <A>(message: string, action: () => Promise<A>): Effect.Effect<A, SyncError> =>
  Effect.tryPromise({ try: action, catch: (cause) => new SyncError({ message, cause }) });

export const explain = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : "Unexpected sync failure. Your local files were preserved.";

export class NetworkError extends Data.TaggedError("NetworkError")<{
  readonly message: string;
  readonly retryable: boolean;
  readonly cause?: unknown;
}> {}
export function retryable(error: unknown): boolean {
  if (error instanceof NetworkError) return error.retryable;
  if (error instanceof SyncError) return retryable(error.cause);
  return false;
}
