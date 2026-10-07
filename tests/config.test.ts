import { describe, expect, it } from "vitest";
import { defaults, loadConfig } from "../src/core/config";

describe("saved configuration", () => {
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
