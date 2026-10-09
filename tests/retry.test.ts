import { expect, it, vi } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { NetworkError, retryable, SyncError } from "../src/core/errors";
import { createRetryLoop, type Outcome, retryDelay } from "../src/platform/retry";

const fixture = Effect.fn(function* (outcome: Outcome = "retry") {
  const host = {
    run: vi.fn((_manual: boolean): Effect.Effect<Outcome> => Effect.succeed(outcome)),
    online: vi.fn(() => true),
    status: vi.fn(),
    random: () => 0.5,
    interval: vi.fn((): number | null => 60000),
  };
  const scope = yield* Effect.scope;
  return { host, loop: createRetryLoop(host, scope) };
});
it.effect("backs off and pauses after six retries", () =>
  Effect.gen(function* () {
    const { host, loop } = yield* fixture();
    yield* loop.request();
    for (const delay of [2000, 4000, 8000, 16000, 32000, 60000]) yield* TestClock.adjust(delay);
    expect(host.run).toHaveBeenCalledTimes(7);
    expect(host.status).toHaveBeenLastCalledWith("Retries paused · Sync now to try again");
    yield* TestClock.adjust(600000);
    expect(host.run).toHaveBeenCalledTimes(7);
  }),
);
it.effect("avoids offline requests and wakes when connectivity returns", () =>
  Effect.gen(function* () {
    const { host, loop } = yield* fixture("success");
    host.online.mockReturnValue(false);
    expect(yield* loop.request()).toBe(false);
    expect(host.run).not.toHaveBeenCalled();
    host.online.mockReturnValue(true);
    expect(yield* loop.wake()).toBe(true);
    expect(host.run).toHaveBeenCalledWith(true);
  }),
);
it.effect("manual sync replaces a pending retry and unload cancels polling", () =>
  Effect.gen(function* () {
    const { host, loop } = yield* fixture();
    yield* loop.request();
    host.run.mockReturnValue(Effect.succeed("success"));
    yield* loop.request();
    yield* TestClock.adjust(2000);
    expect(host.run).toHaveBeenCalledTimes(2);
    yield* loop.stop();
    yield* TestClock.adjust(60000);
    expect(host.run).toHaveBeenCalledTimes(2);
  }),
);
it.effect("stops on permanent failures and prevents concurrent runs", () =>
  Effect.gen(function* () {
    const { host, loop } = yield* fixture("stop");
    const release = yield* Deferred.make<Outcome>();
    const started = yield* Deferred.make<void>();
    host.run.mockReturnValueOnce(
      Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release))),
    );
    const running = yield* Effect.forkChild(loop.request());
    yield* Deferred.await(started);
    expect(yield* loop.request()).toBe(false);
    yield* Deferred.succeed(release, "stop");
    yield* Fiber.join(running);
    yield* TestClock.adjust(600000);
    expect(host.run).toHaveBeenCalledOnce();
  }),
);
it("bounds jitter and classifies nested transport failures", () => {
  expect(retryDelay(0, 0)).toBe(1600);
  expect(retryDelay(0, 1)).toBeCloseTo(2400);
  expect(retryDelay(20, 1)).toBe(60000);
  const network = new NetworkError({ message: "Offline", retryable: true });
  expect(retryable(new SyncError({ message: "Fetch failed", cause: network }))).toBe(true);
  expect(retryable(new NetworkError({ message: "HTTP 401", retryable: false }))).toBe(false);
  expect(retryable(new Error("Storage failed"))).toBe(false);
});
it.effect("stops polling on disconnect and restarts on reconnect", () =>
  Effect.gen(function* () {
    const { host, loop } = yield* fixture("success");
    yield* loop.start();
    yield* TestClock.adjust(0);
    expect(host.run).toHaveBeenCalledOnce();
    yield* loop.stop();
    yield* TestClock.adjust(120000);
    expect(host.run).toHaveBeenCalledOnce();
    yield* loop.start();
    yield* TestClock.adjust(0);
    expect(host.run).toHaveBeenCalledTimes(2);
  }),
);
it.effect(
  "uses the configured polling interval and keeps manual sync available when automatic sync is off",
  () =>
    Effect.gen(function* () {
      const { host, loop } = yield* fixture("success");
      host.interval.mockReturnValue(15000);
      yield* loop.start();
      yield* TestClock.adjust(0);
      yield* TestClock.adjust(14999);
      expect(host.run).toHaveBeenCalledOnce();
      yield* TestClock.adjust(1);
      expect(host.run).toHaveBeenCalledTimes(2);
      host.interval.mockReturnValue(null);
      yield* loop.start();
      yield* TestClock.adjust(900000);
      expect(host.run).toHaveBeenCalledTimes(2);
      expect(yield* loop.request()).toBe(true);
      expect(host.run).toHaveBeenLastCalledWith(true);
      yield* TestClock.adjust(900000);
      expect(host.run).toHaveBeenCalledTimes(3);
    }),
);
it.effect("runs again when local changes arrive during an active sync", () =>
  Effect.gen(function* () {
    const { host, loop } = yield* fixture("success");
    const release = yield* Deferred.make<Outcome>();
    const started = yield* Deferred.make<void>();
    host.run.mockReturnValueOnce(
      Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release))),
    );
    const running = yield* Effect.forkChild(loop.wake());
    yield* Deferred.await(started);
    yield* loop.wake();
    yield* loop.wake();
    expect(host.run).toHaveBeenCalledOnce();
    yield* Deferred.succeed(release, "success");
    yield* Fiber.join(running);
    yield* TestClock.adjust(0);
    expect(host.run).toHaveBeenCalledTimes(2);
  }),
);
it.effect("releases the busy guard when a running request is interrupted", () =>
  Effect.gen(function* () {
    const { host, loop } = yield* fixture("success");
    const started = yield* Deferred.make<void>();
    host.run.mockReturnValueOnce(
      Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
    );
    const running = yield* Effect.forkChild(loop.request());
    yield* Deferred.await(started);
    yield* Fiber.interrupt(running);
    expect(yield* loop.request()).toBe(true);
  }),
);
