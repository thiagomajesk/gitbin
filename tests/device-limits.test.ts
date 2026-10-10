import { expect, it, vi } from "vitest";
import { defaults, loadConfig } from "../src/core/config";
import { deviceLimits } from "../src/platform/device-limits";

vi.mock("obsidian", () => ({ Platform: { isMobile: false } }));
it("uses the configured maximum equally for notes and attachments", () => {
  for (const maxDownloadMegabytes of [5, 10, 25, 50, 100]) {
    const limits = deviceLimits({ ...defaults(), maxDownloadMegabytes });
    expect(limits.downloadBytes).toBe(maxDownloadMegabytes * 1024 * 1024);
  }
});
it("keeps a file limit with unlimited storage and clamps finite storage on reload", () => {
  const config = loadConfig({ ...defaults(), storageMegabytes: 50, maxDownloadMegabytes: 100 });
  expect(deviceLimits(config).downloadBytes).toBe(50 * 1024 * 1024);
  expect(deviceLimits({ ...config, storageMegabytes: "unlimited" }).downloadBytes).toBe(
    50 * 1024 * 1024,
  );
});

it("allows unlimited downloads when both settings are unlimited", () => {
  const config = loadConfig({
    ...defaults(),
    storageMegabytes: "unlimited",
    maxDownloadMegabytes: "unlimited",
  });
  expect(config.maxDownloadMegabytes).toBe("unlimited");
  const limits = deviceLimits(config);
  expect(limits.downloadBytes).toBe(Infinity);
  expect(loadConfig({ ...config, storageMegabytes: 500 }).maxDownloadMegabytes).toBe(500);
});
