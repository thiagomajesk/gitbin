import { beforeEach, expect, it, vi } from "vitest";
import { hostname } from "node:os";
import { commitAuthor, deviceName } from "../src/platform/device";

it("uses the supplied email for attribution and retains the optional fallback", () => {
  expect(commitAuthor({ username: "alice", commitEmail: "alice@example.com" }, "Laptop")).toEqual({
    name: "alice",
    email: "alice@example.com",
  });
  expect(commitAuthor({ username: "alice", commitEmail: "" }, "Laptop")).toEqual({
    name: "alice",
    email: "alice@Laptop",
  });
});

const platform = vi.hoisted(() => ({ isDesktopApp: true, isIosApp: false }));
vi.mock("obsidian", () => ({ Platform: platform }));
beforeEach(() => {
  platform.isDesktopApp = true;
  platform.isIosApp = false;
});

it("uses the desktop hostname without creating a device ID", async () => {
  const storage = { getSecret: vi.fn(() => null), setSecret: vi.fn() };
  expect(await deviceName(storage)).toBe(hostname());
  expect(storage.getSecret).not.toHaveBeenCalled();
  expect(storage.setSecret).not.toHaveBeenCalled();
});

it.each([true, false])("retains the mobile device label across calls (iOS: %s)", async (ios) => {
  platform.isDesktopApp = false;
  platform.isIosApp = ios;
  const secrets = new Map<string, string>();
  const storage = {
    getSecret: (key: string) => secrets.get(key) ?? null,
    setSecret: vi.fn((key: string, value: string) => {
      secrets.set(key, value);
    }),
  };
  const first = await deviceName(storage);
  expect(first).toMatch(ios ? /^iOS-[a-f0-9]{8}$/ : /^Android-[a-f0-9]{8}$/);
  expect(await deviceName(storage)).toBe(first);
  expect(storage.setSecret).toHaveBeenCalledTimes(1);
});
