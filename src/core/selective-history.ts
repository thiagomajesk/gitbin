import { Effect } from "effect";
import { attempt, SyncError } from "./errors";
import { type FileChange, type FileSnapshot } from "./history";
import type { InventoryFile, ObjectReference } from "./inventory";
import type { SelectiveContext } from "./selective-context";

export function inventorySnapshots(files: Iterable<InventoryFile>): FileSnapshot[] {
  return [...files].map((file) => ({
    id: file.id,
    path: file.path,
    text: null,
    binary: file.kind === "binary",
    hash: file.content.hash,
    content: file.content,
  }));
}
const loadVersion = Effect.fn("history.loadVersion")(function* (
  ctx: SelectiveContext,
  file: FileSnapshot | null,
  online: () => boolean,
) {
  if (!file?.content || file.binary || file.path === null || file.text !== null) return file;
  const limit = ctx.limits().downloadBytes;
  const bytes = yield* previewBytes(ctx, file.content, limit, online);
  const text = yield* attempt("Cannot decode historical text.", () =>
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
  );
  return { ...file, text };
});
const previewBytes = Effect.fn("history.previewBytes")(function* (
  ctx: SelectiveContext,
  content: ObjectReference,
  limit: number,
  online: () => boolean,
) {
  ctx.staging.add(content.hash);
  const cached = yield* ctx.local.object(content, Infinity);
  if (cached) return cached;
  if (content.bytes > limit)
    return yield* new SyncError({
      message:
        "This comparison exceeds the max download size. Increase the limit in Settings, then try again.",
    });
  if (!online())
    return yield* new SyncError({
      message: "Connect to the internet to download this comparison.",
    });
  return yield* ctx.object(content, limit);
});
export const loadHistoryChange = Effect.fn("history.loadComparison")(function* (
  ctx: SelectiveContext,
  change: FileChange,
  online: () => boolean = () => true,
) {
  return yield* Effect.gen(function* () {
    const baseline = yield* loadVersion(ctx, change.baseline, online);
    const local = yield* loadVersion(ctx, change.local, online);
    const incoming = yield* loadVersion(ctx, change.incoming, online);
    const result = yield* loadVersion(ctx, change.result, online);
    return { ...change, baseline, local, incoming, result: result ?? change.result };
  }).pipe(Effect.ensuring(Effect.sync(() => ctx.staging.clear())));
});

export const historyCached = Effect.fn("history.cached")(function* (
  ctx: SelectiveContext,
  change: FileChange,
): Effect.fn.Return<boolean, SyncError> {
  const checked = new Set<string>();
  for (const file of [change.baseline, change.local, change.incoming, change.result]) {
    if (!file?.content || file.binary || file.path === null || file.text !== null) continue;
    if (checked.has(file.content.hash)) continue;
    if (!(yield* ctx.local.hasObject(file.content))) return false;
    checked.add(file.content.hash);
  }
  return true;
});
