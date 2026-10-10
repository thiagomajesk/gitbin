import { afterEach, expect, it, vi } from "vitest";
import { obsidianFetch } from "../src/platform/http";

const native = vi.hoisted(() => vi.fn());
vi.mock("obsidian", () => ({ requestUrl: native }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  native.mockReset();
});

it("keeps the native transfer slot after a deadline and starts the next deadline only when its request starts", async () => {
  vi.stubGlobal("window", globalThis);
  vi.useFakeTimers();
  const response = { arrayBuffer: new ArrayBuffer(0), status: 200, headers: {} };
  let resolveFirst: (value: typeof response) => void = () => {
    throw new Error("Missing deferred request");
  };
  const first = new Promise<typeof response>((resolve) => {
    resolveFirst = resolve;
  });
  native.mockReturnValueOnce(first).mockResolvedValueOnce(response);
  const timedOut = obsidianFetch("https://example.com/first").catch((error: unknown) => error);
  const queued = obsidianFetch("https://example.com/second");
  await vi.advanceTimersByTimeAsync(30001);
  expect(await timedOut).toBeInstanceOf(Error);
  expect(native).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(30001);
  expect(native).toHaveBeenCalledTimes(1);
  resolveFirst(response);
  expect((await queued).status).toBe(200);
  expect(native).toHaveBeenCalledTimes(2);
});
