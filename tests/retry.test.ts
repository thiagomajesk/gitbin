import { afterEach, describe, expect, it, vi } from "vitest";
import { createRetryLoop, retryDelay, type Outcome } from "../src/platform/retry";
import { NetworkError, SyncError, retryable } from "../src/core/errors";
afterEach(() => vi.useRealTimers());
function fixture(outcome: Outcome = "retry") {
  vi.useFakeTimers();
  const host = {
    run: vi.fn(async (_manual: boolean): Promise<Outcome> => outcome),
    online: vi.fn(() => true),
    status: vi.fn(),
    random: () => 0.5,
    interval: vi.fn((): number | null => 60000),
  };
  const loop = createRetryLoop(host);
  return { host, loop };
}
describe("sync scheduling", () => {
  it("backs off and pauses after six retries", async () => {
    const { host, loop } = fixture();
    await loop.request();
    for (const delay of [2000, 4000, 8000, 16000, 32000, 60000])
      await vi.advanceTimersByTimeAsync(delay);
    expect(host.run).toHaveBeenCalledTimes(7);
    expect(host.status).toHaveBeenLastCalledWith("Retries paused · Sync now to try again");
    await vi.advanceTimersByTimeAsync(600000);
    expect(host.run).toHaveBeenCalledTimes(7);
    loop.stop();
  });
  it("avoids offline requests and wakes when connectivity returns", async () => {
    const { host, loop } = fixture("success");
    host.online.mockReturnValue(false);
    expect(await loop.request()).toBe(false);
    expect(host.run).not.toHaveBeenCalled();
    host.online.mockReturnValue(true);
    expect(await loop.wake()).toBe(true);
    expect(host.run).toHaveBeenCalledWith(true);
    loop.stop();
  });
  it("manual sync replaces a pending retry and unload cancels polling", async () => {
    const { host, loop } = fixture();
    await loop.request();
    host.run.mockResolvedValue("success");
    await loop.request();
    await vi.advanceTimersByTimeAsync(2000);
    expect(host.run).toHaveBeenCalledTimes(2);
    loop.stop();
    await vi.advanceTimersByTimeAsync(60000);
    expect(host.run).toHaveBeenCalledTimes(2);
  });
  it("stops on permanent failures and prevents concurrent runs", async () => {
    const { host, loop } = fixture("stop");
    let release: ((outcome: Outcome) => void) | undefined;
    host.run.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const running = loop.request();
    expect(await loop.request()).toBe(false);
    release?.("stop");
    await running;
    await vi.advanceTimersByTimeAsync(600000);
    expect(host.run).toHaveBeenCalledOnce();
    loop.stop();
  });
  it("bounds jitter and classifies nested transport failures", () => {
    expect(retryDelay(0, 0)).toBe(1600);
    expect(retryDelay(0, 1)).toBeCloseTo(2400);
    expect(retryDelay(20, 1)).toBe(60000);
    const network = new NetworkError({ message: "Offline", retryable: true });
    expect(retryable(new SyncError({ message: "Fetch failed", cause: network }))).toBe(true);
    expect(retryable(new NetworkError({ message: "HTTP 401", retryable: false }))).toBe(false);
    expect(retryable(new Error("Storage failed"))).toBe(false);
  });
});

it("stops polling on disconnect and restarts on reconnect", async () => {
  const { host, loop } = fixture("success");
  loop.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(host.run).toHaveBeenCalledOnce();
  loop.stop();
  await vi.advanceTimersByTimeAsync(120000);
  expect(host.run).toHaveBeenCalledOnce();
  loop.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(host.run).toHaveBeenCalledTimes(2);
  loop.stop();
});
it("uses the configured polling interval and keeps manual sync available when automatic sync is off", async () => {
  const { host, loop } = fixture("success");
  host.interval.mockReturnValue(15000);
  loop.start();
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(14999);
  expect(host.run).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(host.run).toHaveBeenCalledTimes(2);
  host.interval.mockReturnValue(null);
  loop.start();
  await vi.advanceTimersByTimeAsync(900000);
  expect(host.run).toHaveBeenCalledTimes(2);
  expect(await loop.request()).toBe(true);
  expect(host.run).toHaveBeenLastCalledWith(true);
  await vi.advanceTimersByTimeAsync(900000);
  expect(host.run).toHaveBeenCalledTimes(3);
  loop.stop();
});
it("runs again when local changes arrive during an active sync", async () => {
  const { host, loop } = fixture("success");
  let release: ((outcome: Outcome) => void) | undefined;
  host.run.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const running = loop.wake();
  await loop.wake();
  await loop.wake();
  expect(host.run).toHaveBeenCalledOnce();
  release?.("success");
  await running;
  await vi.advanceTimersByTimeAsync(0);
  expect(host.run).toHaveBeenCalledTimes(2);
  loop.stop();
});
