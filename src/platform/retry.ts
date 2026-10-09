import { Effect, Fiber, type Scope } from "effect";
export type Outcome = "success" | "retry" | "stop";
export interface RetryHost {
  run(manual: boolean): Effect.Effect<Outcome>;
  online(): boolean;
  status(message: string): void;
  random(): number;
  interval(): number | null;
}
export const retryDelay = (attempt: number, random: number): number =>
  Math.min(60000, 2000 * 2 ** attempt * (0.8 + random * 0.4));

export function createRetryLoop(host: RetryHost, scope: Scope.Scope) {
  let timer: Fiber.Fiber<void> | undefined;
  let stopped = false;
  let busy = false;
  let attempt = 0;
  let manual = false;
  let queued = false;
  const cancel = Effect.fn(function* () {
    const pending = timer;
    timer = undefined;
    if (pending) yield* Fiber.interrupt(pending);
  });
  const schedule = Effect.fn(function* (delay: number) {
    yield* cancel();
    timer = yield* Effect.gen(function* () {
      yield* Effect.sleep(delay);
      timer = undefined;
      yield* run();
    }).pipe(Effect.forkIn(scope));
  });
  const retry = Effect.fn(function* () {
    if (attempt >= 6) {
      host.status("Retries paused · Sync now to try again");
      return;
    }
    const delay = retryDelay(attempt++, host.random());
    host.status("Retry " + attempt + "/6 in " + Math.ceil(delay / 1000) + " seconds");
    yield* schedule(delay);
  });
  const handle = Effect.fn(function* (outcome: Outcome) {
    if (stopped || outcome === "stop") return;
    if (outcome === "retry") return yield* retry();
    attempt = 0;
    manual = false;
    const delay = queued ? 0 : host.interval();
    queued = false;
    if (delay !== null) yield* schedule(delay);
  });
  const run = (): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      if (stopped || busy) return false;
      // Acquire the guard before interruption can yield to another request.
      busy = true;
      return yield* Effect.gen(function* () {
        yield* cancel();
        if (!host.online()) {
          host.status("Offline · Changes stay on this device");
          return false;
        }
        const outcome = yield* host.run(manual);
        yield* handle(outcome);
        return outcome === "success";
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            busy = false;
          }),
        ),
      );
    });
  return {
    start: Effect.fn(function* () {
      stopped = false;
      attempt = 0;
      manual = false;
      queued = false;
      yield* cancel();
      if (host.interval() !== null) yield* schedule(0);
    }),
    request: Effect.fn(function* () {
      attempt = 0;
      manual = true;
      return yield* run();
    }),
    wake: Effect.fn(function* () {
      attempt = 0;
      if (busy && !stopped) {
        queued = true;
        return false;
      }
      return yield* run();
    }),
    stop: Effect.fn(function* () {
      stopped = true;
      queued = false;
      yield* cancel();
    }),
  };
}
