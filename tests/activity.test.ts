import { expect, it } from "@effect/vitest";
import { Effect, Logger } from "effect";
import {
  ActivityEvent,
  activityFailure,
  reportProgress,
  sanitizeActivity,
} from "../src/core/activity";
import { defaults } from "../src/core/config";
import { SyncError } from "../src/core/errors";
import { ActivityLog } from "../src/platform/activity-log";
import { createUiStore } from "../src/ui/store";
import { selectiveFixture } from "./selective-fixture";

function fixture(initial = "") {
  let saved = initial;
  const store = createUiStore({ config: defaults(), status: "Ready", error: null });
  const adapter = {
    exists: async () => Boolean(saved),
    read: async () => saved,
    write: async (_path: string, data: string) => {
      saved = data;
    },
  };
  const log = new ActivityLog(adapter, "activity.json", store, () => ["private-password"]);
  return { store, adapter, log, saved: () => saved };
}
it("removes URL credentials, query values, headers and bare saved passwords", () => {
  const value = sanitizeActivity(
    "Rejected https://user:pass@example.test/repo?token=secret\nAuthorization: Bearer abc\nCookie: id=abc\npassword=bad\nghp_1234 private-password",
    ["private-password"],
  );
  for (const secret of ["user:pass", "token=secret", "abc", "bad", "ghp_1234", "private-password"])
    expect(value).not.toContain(secret);
  expect(value).toContain("Rejected");
});
it("preserves nested server rejection reasons without credentials or unbounded output", () => {
  const error = new SyncError({
    message: "Cannot upload. Changes remain local.",
    cause: new Error("remote: branch protected; token=secret"),
  });
  expect(activityFailure(error)).toContain("branch protected");
  expect(activityFailure(error)).not.toContain("secret");
  expect(sanitizeActivity("a".repeat(10000))).toHaveLength(1000);
});
it("bounds activity, sanitizes before writing and restores it after restart", async () => {
  const f = fixture();
  for (let i = 0; i < 250; i++) f.log.record("Event " + i + " private-password");
  await f.log.flush();
  expect(f.store.getSnapshot().activity).toHaveLength(200);
  expect(f.saved()).not.toContain("private-password");
  const restored = fixture(f.saved());
  await restored.log.load();
  expect(restored.store.getSnapshot().activity).toEqual(f.store.getSnapshot().activity);
});
it("keeps logging after malformed saved activity or a failed write", async () => {
  const f = fixture("broken");
  await f.log.load();
  expect(f.store.getSnapshot().activity?.[0]?.level).toBe("error");
  const write = f.adapter.write;
  f.adapter.write = async () => {
    throw new Error("Disk full");
  };
  await f.log.flush();
  expect(f.store.getSnapshot().activityWarning).toContain("could not be saved");
  f.adapter.write = write;
  await f.log.flush();
  expect(f.store.getSnapshot().activityWarning).toBeNull();
});
it.effect("uses Effect progress events for the log and current phase", () =>
  Effect.gen(function* () {
    const f = fixture();
    yield* reportProgress("Checking remote changes…").pipe(
      Effect.provide(Logger.layer([f.log.logger])),
    );
    expect(f.store.getSnapshot().phase).toBe("Checking remote changes…");
    expect(f.store.getSnapshot().activity?.[0]?.message).toBe("Checking remote changes");
  }),
);
it.effect("reports real sync phases and does not claim an upload for a no-op", () =>
  Effect.gen(function* () {
    const f = fixture();
    const { a } = yield* selectiveFixture();
    yield* a.engine.sync().pipe(Effect.provide(Logger.layer([f.log.logger])));
    const messages = f.store.getSnapshot().activity?.map((entry) => entry.message);
    expect(messages).toContain("Checking remote changes");
    expect(messages).toContain("Applying changes");
    expect(messages).not.toContain("Uploading local changes");
  }),
);

it("stores a flat chronological stream with safe details and completion levels", async () => {
  const f = fixture();
  f.log.record("Sync started");
  f.log.record("Uploading", "info", "token=private-password");
  f.log.record("Sync completed", "success");
  await f.log.flush();
  const entries = f.store.getSnapshot().activity ?? [];
  expect(entries.map((entry) => entry.message)).toEqual([
    "Sync started",
    "Uploading",
    "Sync completed",
  ]);
  expect(entries[2]?.level).toBe("success");
  expect(f.saved()).not.toContain("private-password");
});
it.effect("preserves Effect warning and error levels", () =>
  Effect.gen(function* () {
    const f = fixture();
    yield* Effect.logWarning(new ActivityEvent("Still pending")).pipe(
      Effect.provide(Logger.layer([f.log.logger])),
    );
    yield* Effect.logError(new ActivityEvent("Failed")).pipe(
      Effect.provide(Logger.layer([f.log.logger])),
    );
    expect(f.store.getSnapshot().activity?.map((entry) => entry.level)).toEqual([
      "warning",
      "error",
    ]);
  }),
);
