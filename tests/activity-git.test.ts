import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { Effect, Logger } from "effect";
import { activityFailure } from "../src/core/activity";
import { defaults } from "../src/core/config";
import { io } from "../src/core/errors";
import { ActivityLog } from "../src/platform/activity-log";
import { createUiStore } from "../src/ui/store";
import { encoded } from "./selective-fixture";
import { realSelectiveFixture } from "./selective-git-fixture";

it.effect("logs a real rejected push and preserves the pending edit and remote baseline", () =>
  Effect.gen(function* () {
    const fixture = yield* realSelectiveFixture();
    const a = yield* fixture.connect();
    a.device.files.set("Note.md", encoded("Before"));
    yield* a.engine.sync();
    const revision = yield* fixture.git(["rev-parse", "main"]);
    const directory = yield* fixture.git(["rev-parse", "--absolute-git-dir"]);
    yield* io("Cannot install rejection fixture.", () =>
      writeFile(
        join(directory, "hooks", "pre-receive"),
        "#!/bin/sh\necho 'branch protected token=secret-value' >&2\nexit 1\n",
        { mode: 0o755 },
      ),
    );
    const store = createUiStore({ config: defaults(), status: "Ready", error: null });
    const log = new ActivityLog(
      { exists: async () => false, read: async () => "", write: async () => {} },
      "activity.json",
      store,
    );
    a.device.files.set("Note.md", encoded("Pending edit"));
    const failure = yield* a.engine
      .sync()
      .pipe(
        Effect.provide(Logger.layer([log.logger])),
        Effect.match({ onSuccess: () => "", onFailure: (error) => activityFailure(error) }),
      );
    expect(failure).toContain("pre-receive hook declined");
    expect(failure).not.toContain("secret-value");
    expect(yield* fixture.git(["rev-parse", "main"])).toBe(revision);
    expect(a.device.files.get("Note.md")).toEqual(encoded("Pending edit"));
    expect(a.engine.details().entries.some((entry) => entry.dirty)).toBe(true);
    expect(
      store.getSnapshot().activity?.some((entry) => entry.message === "Uploading local changes"),
    ).toBe(true);
  }),
);
