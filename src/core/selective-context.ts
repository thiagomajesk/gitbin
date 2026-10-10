import { Effect } from "effect";
import { type AvailabilityEntry, type AvailabilityIntent } from "./availability";
import { SyncError } from "./errors";
import { emptyHistory, type HistoryState } from "./history";
import { type ObjectReference, objectReference } from "./inventory";
import { currentMetadata } from "./metadata";
import type { Registration } from "./protocol";
import type { DeviceLimits, SelectiveRemote, SelectiveVault } from "./selective-ports";

export interface SelectiveContext {
  readonly vault: Registration;
  readonly local: SelectiveVault;
  readonly remote: SelectiveRemote;
  readonly limits: () => DeviceLimits;
  readonly entries: Map<string, AvailabilityEntry>;
  readonly protected: Set<string>;
  readonly staging: Set<string>;
  readonly issues: Map<string, string>;
  intents: readonly AvailabilityIntent[];
  revision: string | null;
  consolidationHash: string | null;
  ready: boolean;
  usage: number;
  transportPinned: boolean;
  history: HistoryState;
  persist(): Effect.Effect<void, SyncError>;
  reserve(bytes: number, message?: string): Effect.Effect<void, SyncError>;
  stage(bytes: Uint8Array): Effect.Effect<ObjectReference, SyncError>;
  object(reference: ObjectReference, limit: number): Effect.Effect<Uint8Array, SyncError>;
  collect(): Effect.Effect<void, SyncError>;
}

export function createSelectiveContext(
  vault: Registration,
  local: SelectiveVault,
  remote: SelectiveRemote,
  limits: () => DeviceLimits,
): SelectiveContext {
  const context: SelectiveContext = {
    vault,
    local,
    remote,
    limits,
    entries: new Map(),
    protected: new Set(),
    staging: new Set(),
    issues: new Map(),
    intents: [],
    revision: null,
    consolidationHash: null,
    ready: false,
    usage: 0,
    transportPinned: false,
    history: emptyHistory(),
    persist: () => persist(context),
    reserve: (bytes, message) => reserve(context, bytes, message),
    stage: (bytes) => stage(context, bytes),
    object: (reference, limit) => object(context, reference, limit),
    collect: () => collect(context),
  };
  return context;
}

const persist = Effect.fn("availability.persist")(function* (ctx: SelectiveContext) {
  const journal = {
    metadata: currentMetadata(ctx.consolidationHash),
    vaultRoot: ctx.vault.root,
    revision: ctx.revision,
    entries: [...ctx.entries.values()],
    intents: ctx.intents,
    history: ctx.history,
  };
  yield* ctx.local.save(journal);
  ctx.local.changed();
});

const collect = Effect.fn("availability.collect")(function* (ctx: SelectiveContext) {
  const retained = new Set(ctx.staging);
  for (const entry of ctx.entries.values()) {
    if (!entry.available && !entry.dirty && !ctx.protected.has(entry.file.id)) continue;
    for (const hash of retainedEntry(entry)) retained.add(hash);
  }
  for (const hash of retainedWrites(ctx.intents)) retained.add(hash);
  for (const hash of (yield* ctx.local.objects()).keys())
    if (!retained.has(hash)) yield* ctx.local.removeObject(hash);
  ctx.usage = yield* ctx.local.usage();
});

function retainedWrites(intents: readonly AvailabilityIntent[]): string[] {
  return intents
    .flatMap((intent) => [intent.before, intent.after, intent.baselineState])
    .flatMap((reference) => (reference ? [reference.hash] : []));
}
function retainedEntry(entry: AvailabilityEntry): string[] {
  return [
    entry.file.state,
    entry.file.content,
    entry.base?.state,
    entry.base?.content,
    entry.localContent,
    entry.baselineState,
  ].flatMap((reference) => (reference ? [reference.hash] : []));
}
function protectedEntry(ctx: SelectiveContext, entry: AvailabilityEntry): boolean {
  return (
    entry.dirty ||
    ctx.protected.has(entry.file.id) ||
    (entry.localPath !== null && ctx.local.active(entry.localPath)) ||
    ctx.intents.some((intent) => intent.id === entry.file.id)
  );
}

const evict = Effect.fn("availability.evict")(function* (
  ctx: SelectiveContext,
  entry: AvailabilityEntry,
) {
  if (!entry.localPath || !entry.localContent || !entry.available || protectedEntry(ctx, entry))
    return false;
  const bytes = yield* ctx.local.read(entry.localPath, entry.localContent.bytes);
  if (!bytes || objectReference(bytes).hash !== entry.localContent.hash) {
    entry.dirty = true;
    return false;
  }
  const empty = yield* ctx.local.put(new Uint8Array());
  const intent = {
    id: entry.file.id,
    path: entry.localPath,
    before: entry.localContent,
    after: empty,
    available: false,
    baselineState: null,
  };
  ctx.intents = [...ctx.intents, intent];
  yield* ctx.persist();
  yield* ctx.local.write(intent.path, intent.before, new Uint8Array(), true);
  entry.available = false;
  entry.localContent = empty;
  entry.baselineState = null;
  ctx.intents = ctx.intents.filter((value) => value !== intent);
  yield* ctx.persist();
  yield* ctx.collect();
  return true;
});

const reserve = Effect.fn("availability.reserve")(function* (
  ctx: SelectiveContext,
  bytes: number,
  message: string = "Not enough space to download this file. Increase the local storage limit in Settings, then try again.",
) {
  const limit = ctx.limits().storageBytes;
  if (limit !== "unlimited" && bytes > limit) return yield* new SyncError({ message });
  ctx.usage = yield* ctx.local.usage();
  if (limit === "unlimited") return;
  if (ctx.usage + bytes <= limit) return;
  yield* ctx.collect();
  if (ctx.usage + bytes <= limit) return;
  yield* evictForSpace(ctx, bytes, limit);
  if (ctx.usage + bytes > limit) return yield* new SyncError({ message });
});

const evictForSpace = Effect.fn("availability.evictForSpace")(function* (
  ctx: SelectiveContext,
  bytes: number,
  limit: number,
) {
  if (!ctx.transportPinned) yield* ctx.remote.clear();
  ctx.usage = yield* ctx.local.usage();
  const candidates = [...ctx.entries.values()].sort((a, b) => a.accessed - b.accessed);
  for (const entry of candidates) {
    if (ctx.usage + bytes <= limit) return;
    yield* evict(ctx, entry).pipe(Effect.catch(() => Effect.succeed(false)));
  }
  ctx.usage = yield* ctx.local.usage();
});

const stage = Effect.fn("availability.stage")(function* (ctx: SelectiveContext, bytes: Uint8Array) {
  const reference = objectReference(bytes);
  ctx.staging.add(reference.hash);
  if (yield* ctx.local.object(reference, bytes.length)) return reference;
  yield* ctx.reserve(bytes.length + 1024);
  return yield* ctx.local.put(bytes);
});

const object = Effect.fn("availability.object")(function* (
  ctx: SelectiveContext,
  reference: ObjectReference,
  limit: number,
) {
  ctx.staging.add(reference.hash);
  const cached = yield* ctx.local.object(reference, limit);
  if (cached) return cached;
  yield* ctx.reserve(reference.bytes * 3 + 65536);
  const bytes = yield* ctx.remote.object(reference, Math.min(limit, reference.bytes));
  yield* ctx.local.put(bytes);
  yield* ctx.remote.release(reference.hash);
  return bytes;
});
