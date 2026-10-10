import { Effect } from "effect";
import { attempt, SyncError } from "./errors";
import { requireCurrentMetadata } from "./metadata";
import { decode, Journal } from "./protocol";

export const decodeJournal = (raw: unknown) =>
  Effect.gen(function* () {
    yield* attempt("Cannot check saved migration state.", () => {
      if (!raw || typeof raw !== "object" || !("vaultRoot" in raw))
        throw new SyncError({ code: "invalid-data", message: "Invalid saved sync data." });
      requireCurrentMetadata((raw as Record<string, unknown>).metadata);
    });
    return yield* decode(Journal, raw);
  });

export function parseStoredData(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new SyncError({
      code: "invalid-data",
      message: "Cannot read saved sync data.",
      detail: "Saved data is not valid JSON. File contents are omitted.",
      cause,
    });
  }
}
