import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Effect } from "effect";
import { io } from "../src/core/errors";
import { createSelectiveEngine } from "../src/core/selective-engine";
import type { DeviceLimits } from "../src/core/selective-ports";
import { consolidation } from "../src/git/consolidation";
import { createSelectiveRemote } from "../src/git/selective";
import { gitServer } from "./git-server";
import { SelectiveDevice, selectiveLimits } from "./selective-fixture";

const execute = promisify(execFile);
export const realSelectiveFixture = Effect.fn("fixture.realSelective")(function* () {
  const directory = yield* io("Cannot create Git fixture.", () =>
    mkdtemp(join(tmpdir(), "gitbin-selective-test-")),
  );
  const remotePath = join(directory, "remote.git");
  const git = (args: string[]) =>
    io("Git fixture failed.", async () =>
      (await execute("git", args, { cwd: remotePath })).stdout.trim(),
    );
  yield* io("Cannot initialize fixture.", () =>
    execute("git", ["init", "--bare", "--initial-branch=main", remotePath], { cwd: directory }),
  );
  const server = yield* Effect.acquireRelease(
    io("Cannot serve fixture.", () => gitServer(directory)),
    (value) => Effect.promise(() => value.close()),
  );
  const connection = {
    url: server.url,
    credentials: () => null,
    network: { fetch },
    identity: { author: { name: "Fixture", email: "fixture@localhost" }, device: "test" },
  };
  const maintenance = consolidation(connection);
  const connect = (
    device = new SelectiveDevice(),
    root = "personal",
    limits: DeviceLimits = { ...selectiveLimits, mode: "all" },
  ) =>
    Effect.gen(function* () {
      const remote = createSelectiveRemote(connection);
      const engine = yield* Effect.acquireRelease(
        Effect.sync(() =>
          createSelectiveEngine({ name: root, root }, device, remote, () => limits),
        ),
        (value) => Effect.sync(() => value.close()),
      );
      yield* engine.open();
      return { engine, device, remote };
    });
  return { connect, maintenance, git, connection };
});
