import { Effect } from "effect";
import type { AvailabilityEntry } from "./availability";
import { downloadAdmission, downloadSpace } from "./download-decisions";
import { SyncError } from "./errors";
import type { SelectiveContext } from "./selective-context";

export const admitDownload = Effect.fn("selective.admitDownload")(function* (
  ctx: SelectiveContext,
  file: AvailabilityEntry["file"],
) {
  const limit = ctx.limits().downloadBytes;
  if (downloadAdmission(file.content.bytes, limit) === "allowed") return;
  if (yield* ctx.local.object(file.content, Infinity)) return;
  return yield* new SyncError({
    message:
      "This file exceeds the max download size. Increase the limit in Settings, then try again.",
  });
});

export const reserveDownload = Effect.fn("selective.reserveDownload")(function* (
  ctx: SelectiveContext,
  file: AvailabilityEntry["file"],
): Effect.fn.Return<void, SyncError> {
  ctx.staging.add(file.state.hash);
  ctx.staging.add(file.content.hash);
  const state = (yield* ctx.local.hasObject(file.state)) ? 0 : file.state.bytes;
  const content = (yield* ctx.local.hasObject(file.content)) ? 0 : file.content.bytes;
  const required = downloadSpace(state, content, file.content.bytes);
  yield* ctx.reserve(
    required,
    "Not enough space to download this file. Increase the local storage limit in Settings, then try again.",
  );
});
