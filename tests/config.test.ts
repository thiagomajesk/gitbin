import { describe, expect, it } from "vitest";
import { defaults, loadConfig } from "../src/core/config";
import { schedulingChanged } from "../src/core/decisions";

describe("saved configuration", () => {
  it("does not restart scheduling for capacity and identity preference edits", () => {
    const before = defaults();
    const after = {
      ...before,
      storageMegabytes: 500,
      maxDownloadMegabytes: 100,
      commitEmail: "a@example.com",
    };
    expect(schedulingChanged(before, after)).toBe(false);
    for (const patch of [
      { autoSync: false },
      { setupComplete: true },
      { uploadDelay: 10000 as const },
      { remoteCheckInterval: 300000 as const },
      { downloadMode: "all" as const },
    ])
      expect(schedulingChanged(before, { ...before, ...patch })).toBe(true);
  });
  it("ignores the inactive storage cap and restores it when on-demand is enabled", () => {
    const config = loadConfig({
      ...defaults(),
      downloadMode: "all",
      storageMegabytes: 50,
      maxDownloadMegabytes: "unlimited",
    });
    expect(config.maxDownloadMegabytes).toBe("unlimited");
    expect(loadConfig({ ...config, downloadMode: "on-demand" }).maxDownloadMegabytes).toBe(50);
  });
  it("initializes a new installation", () => {
    expect(loadConfig(null).setupComplete).toBe(false);
  });

  it("loads the current complete format", () => {
    const config = defaults();
    expect(loadConfig(config)).toEqual(config);
  });

  it("rejects incomplete saved settings instead of filling missing fields", () => {
    expect(() => loadConfig({ remote: "https://git.example/notes.git" })).toThrow();
  });

  it("rejects obsolete fields instead of silently discarding them", () => {
    expect(() => loadConfig({ ...defaults(), vaultId: "obsolete" })).toThrow();
  });

  it("persists a commit email and rejects malformed or injected commit identities", () => {
    expect(loadConfig({ ...defaults(), commitEmail: "alice@example.com" }).commitEmail).toBe(
      "alice@example.com",
    );
    for (const commitEmail of ["alice", "alice@example.com\nInjected", "alice <alice@example.com>"])
      expect(() => loadConfig({ ...defaults(), commitEmail })).toThrow();
  });
});
it("accepts supported sync delays and rejects unsupported intervals", () => {
  expect(
    loadConfig({ ...defaults(), uploadDelay: 5000, remoteCheckInterval: 300000 }),
  ).toMatchObject({ uploadDelay: 5000, remoteCheckInterval: 300000 });
  expect(() => loadConfig({ ...defaults(), uploadDelay: 0 })).toThrow();
  expect(() => loadConfig({ ...defaults(), remoteCheckInterval: -1 })).toThrow();
});
it("accepts custom storage limits and defaults to 100 MB", () => {
  expect(defaults().storageMegabytes).toBe(100);
  expect(loadConfig({ ...defaults(), storageMegabytes: 0 }).storageMegabytes).toBe("unlimited");
  expect(loadConfig({ ...defaults(), storageMegabytes: null }).storageMegabytes).toBe(100);
  expect(loadConfig({ ...defaults(), storageMegabytes: 375 }).storageMegabytes).toBe(375);
  for (const storageMegabytes of [-1, 1.5, Infinity, 8589934592])
    expect(() => loadConfig({ ...defaults(), storageMegabytes })).toThrow();
});

it("defaults older settings to 25 MB and clamps downloads to finite storage", () => {
  const { maxDownloadMegabytes: _, ...legacy } = defaults();
  expect(loadConfig(legacy).maxDownloadMegabytes).toBe(25);
  expect(loadConfig({ ...defaults(), storageMegabytes: 10 }).maxDownloadMegabytes).toBe(10);
  expect(
    loadConfig({ ...defaults(), storageMegabytes: "unlimited", maxDownloadMegabytes: 100 })
      .maxDownloadMegabytes,
  ).toBe(100);
  for (const maxDownloadMegabytes of [0, -1, 1.5, Infinity, 8589934592])
    expect(() => loadConfig({ ...defaults(), maxDownloadMegabytes })).toThrow();
});
