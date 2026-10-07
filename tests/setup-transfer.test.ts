import { expect, it, vi } from "vitest";
import { defaults } from "../src/core/config";
import { decodeSetup, importSetup, exportSetup } from "../src/auth/setup-transfer";
import { createUiStore } from "../src/ui/store";
import type { SetupActions } from "../src/ui/setup-types";

const payload = {
  version: 1 as const,
  remote: "https://github.com/you/vault.git",
  root: "My vault",
  credentials: { type: "basic" as const, username: "you", password: "token-秘密" },
  commitEmail: "you@example.com",
  settings: { autoSync: true, uploadDelay: 10000 as const, remoteCheckInterval: 300000 as const },
};

it("exports only a connected configuration and refuses an unavailable saved secret", () => {
  expect(() => exportSetup(defaults(), null)).toThrow("Connect");
  const config = {
    ...defaults(),
    ...payload.settings,
    setupComplete: true,
    remote: payload.remote,
    root: payload.root,
    commitEmail: payload.commitEmail,
    secretId: "local-secret",
  };
  expect(() => exportSetup(config, null)).toThrow("unavailable");
  expect(exportSetup(config, { remote: payload.remote, credentials: payload.credentials })).toEqual(
    payload,
  );
});
it.each([
  { ...payload, version: 2 },
  { ...payload, remote: "https://you:secret@example.com/vault.git" },
  { ...payload, root: "../other" },
  { ...payload, credentials: { type: "ssh", password: "private" } },
  { ...payload, settings: { ...payload.settings, uploadDelay: 1 } },
  { ...payload, secretId: "desktop-secret" },
])("rejects unsupported decrypted setup without exposing its contents", (input) => {
  expect(() => decodeSetup(input)).toThrow("Invalid or unsupported setup code.");
});
function actions(): SetupActions {
  return {
    vaultName: payload.root,
    store: createUiStore({ config: defaults(), status: "Ready", error: null }),
    savedAuthentication: () => null,
    scanToSync: vi.fn(),
    saveSyncPreferences: vi.fn(),
    disconnect: vi.fn(),
    synchronize: vi.fn(),
    inspect: vi.fn(async () => ({ vaults: [{ root: payload.root, name: payload.root }] })),
    finish: vi.fn(async () => true),
  };
}

it("imports through the existing inspected setup path using fresh device state", async () => {
  const target = actions();
  await importSetup(target, payload);
  expect(target.inspect).toHaveBeenCalledWith({
    remote: payload.remote,
    credentials: payload.credentials,
  });
  expect(target.finish).toHaveBeenCalledWith(
    {
      ...defaults(),
      connectedAt: expect.any(Number),
      remote: payload.remote,
      root: payload.root,
      username: "you",
      commitEmail: payload.commitEmail,
      ...payload.settings,
    },
    { remote: payload.remote, credentials: payload.credentials },
  );
});

it("refuses a different vault or an existing connection before using the credential", async () => {
  const target = actions();
  await expect(importSetup(target, { ...payload, root: "Another vault" })).rejects.toThrow(
    "same name",
  );
  target.store.update({ config: { ...defaults(), setupComplete: true } });
  await expect(importSetup(target, payload)).rejects.toThrow("Disconnect");
  expect(target.inspect).not.toHaveBeenCalled();
  expect(target.finish).not.toHaveBeenCalled();
});

it("does not save credentials when inspection fails and reports a failed initial sync", async () => {
  const target = actions();
  vi.mocked(target.inspect).mockResolvedValueOnce(null);
  await expect(importSetup(target, payload)).rejects.toThrow("Could not connect");
  expect(target.finish).not.toHaveBeenCalled();
  vi.mocked(target.finish).mockResolvedValueOnce(false);
  await expect(importSetup(target, payload)).rejects.toThrow("Connection could not finish");
});

it("does not replace a connection established while repository inspection was running", async () => {
  const target = actions();
  vi.mocked(target.inspect).mockImplementationOnce(async () => {
    target.store.update({ config: { ...defaults(), setupComplete: true } });
    return { vaults: [] };
  });
  await expect(importSetup(target, payload)).rejects.toThrow("Disconnect");
  expect(target.finish).not.toHaveBeenCalled();
});
