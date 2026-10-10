import { Effect } from "effect";
import type { AvailabilityEntry, AvailabilityIntent } from "./availability";
import { explain, SyncError } from "./errors";
import { type ObjectReference, objectReference } from "./inventory";
import type { SelectiveContext } from "./selective-context";

function finish(ctx: SelectiveContext, intent: AvailabilityIntent): void {
  const entry = ctx.entries.get(intent.id);
  if (entry && intent.after) {
    entry.localPath = intent.path;
    entry.localContent = intent.after;
    entry.available = intent.available;
    entry.baselineState = intent.baselineState;
  } else if (entry?.localPath === intent.path) {
    entry.localPath = null;
    entry.localContent = null;
    entry.available = false;
    entry.baselineState = null;
  }
  ctx.intents = ctx.intents.filter((value) => value !== intent);
}

const completeWrite = Effect.fn("availability.completeWrite")(function* (
  ctx: SelectiveContext,
  intent: AvailabilityIntent,
  flush = true,
) {
  const bytes = intent.after ? yield* ctx.local.object(intent.after, intent.after.bytes) : null;
  if (intent.after && !bytes)
    return yield* new SyncError({
      message: "An interrupted write is missing its saved bytes. Recovery data was preserved.",
    });
  yield* ctx.local.write(
    intent.path,
    intent.before,
    bytes,
    !intent.available && intent.after !== null,
  );
  finish(ctx, intent);
  if (flush) yield* ctx.persist();
});

export const recoverWrites = Effect.fn("availability.recoverWrites")(function* (
  ctx: SelectiveContext,
) {
  if (ctx.intents.length === 0) return;
  for (const intent of [...ctx.intents]) {
    const recover = Effect.gen(function* () {
      const current = yield* ctx.local.read(intent.path, writeLimit(intent));
      const hash = current ? objectReference(current).hash : null;
      if (hash === (intent.after?.hash ?? null)) {
        finish(ctx, intent);
        return;
      }
      if (!intent.available && intent.after && ctx.local.active(intent.path)) {
        ctx.intents = ctx.intents.filter((value) => value !== intent);
        return;
      }
      yield* completeWrite(ctx, intent, false);
    });
    yield* recover.pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          const entry = ctx.entries.get(intent.id);
          if (entry) {
            entry.issue = explain(error);
            entry.dirty = true;
          }
          ctx.intents = ctx.intents.filter((value) => value !== intent);
        }),
      ),
    );
  }
  yield* ctx.persist();
});

function writeLimit(intent: AvailabilityIntent): number {
  return Math.max(intent.before?.bytes ?? 0, intent.after?.bytes ?? 0);
}

export const writeEntry = Effect.fn("availability.writeEntry")(function* (
  ctx: SelectiveContext,
  entry: AvailabilityEntry,
  path: string,
  before: ObjectReference | null,
  after: ObjectReference | null,
  available: boolean,
) {
  const baselineState = available
    ? after?.hash === entry.file.content.hash
      ? entry.file.state
      : entry.baselineState
    : null;
  const intent = { id: entry.file.id, path, before, after, available, baselineState };
  ctx.intents = [...ctx.intents, intent];
  yield* ctx.persist();
  yield* completeWrite(ctx, intent);
});
