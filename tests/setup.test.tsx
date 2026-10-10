// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { Authentication } from "../src/auth/credentials";
import { type Config, defaults, type SyncPreferences } from "../src/core/config";
import { issueValue } from "../src/ui/issue-values";
import { SetupForm } from "../src/ui/setup-form";
import type { RepositoryInspection } from "../src/ui/setup-types";
import { createUiStore } from "../src/ui/store";

afterEach(cleanup);

it("lets the whole sync switch toggle while a migration is pending", async () => {
  const actions = setup();
  actions.store.update({
    config: { ...defaults(), setupComplete: true, autoSync: false },
    error: "Pending migrations",
    issue: { kind: "migration-required", ...issueValue("migration-required", null) },
  });
  render(<SetupForm actions={actions} />);
  const toggle = screen.getByRole<HTMLInputElement>("switch", { name: "Sync automatically" });
  expect(toggle.disabled).toBe(false);
  await userEvent.setup().click(toggle.parentElement as HTMLElement);
  expect(actions.store.getSnapshot().config.autoSync).toBe(true);
  expect(screen.getByText("Migration required")).toBeTruthy();
});
vi.mock("obsidian", () => ({ setTooltip: vi.fn() }));
function setup(vaults: RepositoryInspection["vaults"] = []) {
  const config = defaults();
  const store = createUiStore({ config, status: "Ready", error: null });
  return {
    vaultName: "My Notes",
    scanToSync: vi.fn(),
    consolidate: () => {},
    reinitialize: () => {},
    saveSyncPreferences: vi.fn(async (preferences: SyncPreferences) => {
      store.update({ config: { ...store.getSnapshot().config, ...preferences } });
      return true;
    }),
    synchronize: vi.fn(async () => true),
    savedAuthentication: vi.fn((): Authentication | null => null),
    store,
    disconnect: vi.fn(async () => {
      store.update({
        config: { ...store.getSnapshot().config, setupComplete: false, autoSync: false },
        status: "Disconnected",
      });
      return true;
    }),
    inspect: vi.fn(
      async (_connection: Authentication): Promise<RepositoryInspection | null> => ({
        vaults,
      }),
    ),
    finish: vi.fn(async (next: Config, _authentication: Authentication) => {
      store.update({
        config: { ...next, setupComplete: true, connectedAt: Date.now() },
        status: "Synced",
      });
      return true;
    }),
  };
}
async function connect(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    screen.getByRole("textbox", { name: "Repository URL" }),
    "https://github.com/you/notes.git",
  );
  await user.type(screen.getByLabelText("Username"), "you");
  await user.type(screen.getByLabelText("Password or access token"), "test-credential");
  await user.click(screen.getByRole("button", { name: "Connect" }));
}
it("connects and starts sync in one action using the vault name", async () => {
  const actions = setup();
  const user = userEvent.setup();
  render(<SetupForm actions={actions} />);
  await connect(user);
  expect(actions.inspect).toHaveBeenCalledWith({
    remote: "https://github.com/you/notes.git",
    credentials: { type: "basic", username: "you", password: "test-credential" },
  });
  expect(actions.finish).toHaveBeenCalledOnce();
  expect(actions.finish.mock.calls[0]?.[0]).toMatchObject({
    root: "My Notes",
    username: "you",
    commitEmail: "",
    autoSync: true,
  });
  expect(actions.store.getSnapshot().config.setupComplete).toBe(true);
  await user.click(screen.getByRole("button", { name: "Scan to sync" }));
  expect(actions.scanToSync).toHaveBeenCalledOnce();
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Disconnect" }).disabled).toBe(
    false,
  );
  expect(screen.queryByRole("button", { name: "Sync this vault" })).toBeNull();
  expect(screen.queryByRole("textbox", { name: "Vault folder" })).toBeNull();
  expect(screen.queryByRole("radiogroup")).toBeNull();
});
it("saves the optional commit email independently of authentication and locks it when connected", async () => {
  const actions = setup();
  const user = userEvent.setup();
  render(<SetupForm actions={actions} />);
  await user.type(screen.getByLabelText("Author email (optional)"), "you@example.com");
  await connect(user);
  expect(actions.finish.mock.calls[0]?.[0].commitEmail).toBe("you@example.com");
  expect(actions.inspect.mock.calls[0]?.[0].credentials).toEqual({
    type: "basic",
    username: "you",
    password: "test-credential",
  });
  expect(screen.getByLabelText("Author email (optional)")).toHaveProperty("disabled", true);
  cleanup();
  render(<SetupForm actions={actions} />);
  expect(screen.getByLabelText("Author email (optional)")).toHaveProperty(
    "value",
    "you@example.com",
  );
});
it("uses the same vault-name folder on another device", async () => {
  const vault = { name: "My Notes", root: "My Notes" };
  const actions = setup([vault]);
  render(<SetupForm actions={actions} />);
  await connect(userEvent.setup());
  expect(actions.finish.mock.calls[0]?.[0]).toMatchObject({ root: vault.root });
});
it("rejects overlapping roots instead of silently renaming the vault", async () => {
  const actions = setup([{ name: "Nested", root: "My Notes/nested" }]);
  render(<SetupForm actions={actions} />);
  await connect(userEvent.setup());
  expect(screen.getByRole("alert").textContent).toContain("portable folder names");
  expect(actions.finish).not.toHaveBeenCalled();
});
it("allows retry after repository access fails", async () => {
  const actions = setup();
  actions.inspect.mockResolvedValueOnce(null);
  const user = userEvent.setup();
  render(<SetupForm actions={actions} />);
  await connect(user);
  expect(screen.getByRole("alert").textContent).toContain("Could not connect");
  await user.click(screen.getByRole("button", { name: "Connect" }));
  expect(actions.finish).toHaveBeenCalledOnce();
});
it("preserves inputs and allows retry when initial sync fails", async () => {
  const actions = setup();
  actions.finish.mockResolvedValueOnce(false);
  const user = userEvent.setup();
  render(<SetupForm actions={actions} />);
  await connect(user);
  expect(screen.getByRole("alert").textContent).toContain("Your notes are preserved");
  expect(actions.store.getSnapshot().config.setupComplete).toBe(false);
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Connect" }).disabled).toBe(false);
  expect(screen.getByLabelText<HTMLInputElement>("Password or access token").value).toBe(
    "test-credential",
  );
  await user.click(screen.getByRole("button", { name: "Connect" }));
  expect(actions.store.getSnapshot().config.setupComplete).toBe(true);
});
it("offers Disconnect after reopening settings with an established connection", () => {
  const actions = setup();
  actions.store.update({
    config: { ...defaults(), setupComplete: true, remote: "https://git.example.com/notes.git" },
  });
  render(<SetupForm actions={actions} />);
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Disconnect" }).disabled).toBe(
    false,
  );
});

it("uses the same generic Git icon for every repository host", async () => {
  const user = userEvent.setup();
  const actions = setup();
  render(<SetupForm actions={actions} />);
  const input = screen.getByRole("textbox", { name: "Repository URL" });
  const button = screen.getByRole("button", { name: "Connect" });
  const icon = button.querySelector(".lucide-plug");
  expect(icon).toBeTruthy();
  for (const remote of [
    "https://github.com/you/notes.git",
    "https://gitlab.com/you/notes.git",
    "https://git.example.com/notes.git",
  ]) {
    await user.clear(input);
    await user.type(input, remote);
    expect(button.querySelector(".lucide-plug")).toBe(icon);
    expect(button.getAttribute("title")).toBeNull();
  }
  expect(actions.inspect).not.toHaveBeenCalled();
});
it("connects anonymously with empty inline credentials and no method selector", async () => {
  const actions = setup();
  const user = userEvent.setup();
  render(<SetupForm actions={actions} />);
  await user.type(screen.getByLabelText("Repository URL"), "https://custom.example/notes.git");
  await user.click(screen.getByRole("button", { name: "Connect" }));
  expect(actions.inspect).toHaveBeenCalledWith({
    remote: "https://custom.example/notes.git",
    credentials: null,
  });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("radiogroup", { name: "Authentication method" })).toBeNull();
});
it("rejects incomplete credentials before checking repository access", async () => {
  const actions = setup();
  const user = userEvent.setup();
  render(<SetupForm actions={actions} />);
  await user.type(screen.getByLabelText("Repository URL"), "https://custom.example/notes.git");
  await user.type(screen.getByLabelText("Username"), "you");
  await user.click(screen.getByRole("button", { name: "Connect" }));
  expect(screen.getByRole("alert").textContent).toContain("Enter both");
  expect(actions.inspect).not.toHaveBeenCalled();
  expect(actions.inspect).not.toHaveBeenCalled();
  expect(actions.finish).not.toHaveBeenCalled();
});

it("reuses a saved credential after remount without exposing it in the input", async () => {
  const actions = setup();
  const saved = {
    remote: "https://git.example.com/notes.git",
    credentials: { type: "basic" as const, username: "you", password: "stored-secret" },
  };
  actions.savedAuthentication.mockReturnValue(saved);
  actions.store.update({
    config: { ...defaults(), remote: saved.remote, username: "you", secretId: "gitbin-test" },
  });
  const first = render(<SetupForm actions={actions} />);
  first.unmount();
  render(<SetupForm actions={actions} />);
  const input = screen.getByLabelText<HTMLInputElement>("Password or access token");
  expect(input.value).toBe("");
  expect(input.placeholder).toBe("");
  await userEvent.setup().click(screen.getByRole("button", { name: "Connect" }));
  expect(actions.inspect).toHaveBeenCalledWith(saved);
  expect(actions.finish).toHaveBeenCalledOnce();
});
it("never reuses a saved credential for a changed repository or username", async () => {
  const actions = setup();
  actions.savedAuthentication.mockReturnValue({
    remote: "https://git.example.com/notes.git",
    credentials: { type: "basic", username: "you", password: "stored-secret" },
  });
  actions.store.update({
    config: { ...defaults(), remote: "https://git.example.com/notes.git", username: "you" },
  });
  const user = userEvent.setup();
  render(<SetupForm actions={actions} />);
  const remote = screen.getByLabelText("Repository URL");
  await user.clear(remote);
  await user.type(remote, "https://other.example/notes.git");
  await user.click(screen.getByRole("button", { name: "Connect" }));
  expect(actions.inspect).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toBeTruthy();
  await user.clear(remote);
  await user.type(remote, "https://git.example.com/notes.git");
  await user.clear(screen.getByLabelText("Username"));
  await user.type(screen.getByLabelText("Username"), "other-user");
  await user.click(screen.getByRole("button", { name: "Connect" }));
  expect(actions.inspect).not.toHaveBeenCalled();
});

it("shows progress only as a spinner inside Connect", async () => {
  const actions = setup();
  let resolve: (value: RepositoryInspection | null) => void = () => {};
  actions.inspect.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  render(<SetupForm actions={actions} />);
  await connect(userEvent.setup());
  const button = screen.getByRole("button", { name: "Connect" });
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect(button.querySelector(".gitbin-spinner")).toBeTruthy();
  expect(screen.queryByText("Connecting and syncing your notes…")).toBeNull();
  await act(async () => {
    resolve({ vaults: [] });
  });
  expect(button.querySelector(".gitbin-spinner")).toBeNull();
  expect(screen.getByText("Connected")).toBeTruthy();
});
it("shows sync status and the latest sync time", () => {
  const actions = setup();
  const connectedAt = new Date("2026-10-05T12:00:00Z").getTime();
  actions.store.update({
    config: { ...defaults(), setupComplete: true, connectedAt, lastSync: connectedAt + 60000 },
  });
  render(<SetupForm actions={actions} />);
  expect(screen.getByText("All changes synced")).toBeTruthy();
  expect(screen.getByRole("region", { name: "Sync status" })).toBeTruthy();
  expect(screen.getByRole("status").className).toBe("gitbin-status-current");
  expect(screen.getByRole("status").children.length).toBe(0);
  expect(
    screen.getByText(
      new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
        connectedAt + 60000,
      ),
    ),
  ).toBeTruthy();
});

it("disconnects without forgetting saved credentials and can reconnect", async () => {
  const actions = setup();
  const user = userEvent.setup();
  render(<SetupForm actions={actions} />);
  await connect(user);
  expect(screen.getByLabelText<HTMLInputElement>("Repository URL").disabled).toBe(true);
  await user.click(screen.getByRole("button", { name: "Disconnect" }));
  expect(actions.disconnect).toHaveBeenCalledOnce();
  expect(actions.store.getSnapshot().config.autoSync).toBe(false);
  expect(screen.getByText("Not connected")).toBeTruthy();
  expect(screen.getByLabelText<HTMLInputElement>("Repository URL").disabled).toBe(false);
  await user.click(screen.getByRole("button", { name: "Connect" }));
  expect(actions.finish).toHaveBeenCalledTimes(2);
  expect(actions.inspect.mock.calls[1]?.[0].credentials).toEqual({
    type: "basic",
    username: "you",
    password: "test-credential",
  });
});
it("keeps the established connection when disconnect fails", async () => {
  const actions = setup();
  actions.disconnect.mockResolvedValueOnce(false);
  const user = userEvent.setup();
  render(<SetupForm actions={actions} />);
  await connect(user);
  await user.click(screen.getByRole("button", { name: "Disconnect" }));
  expect(screen.getByRole("alert").textContent).toContain("Could not disconnect");
  expect(screen.getByText("Connected")).toBeTruthy();
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Disconnect" }).disabled).toBe(
    false,
  );
});

it("fills a connected password field with a mask matching the stored credential length", () => {
  const actions = setup();
  const password = "stored-secret";
  actions.savedAuthentication.mockReturnValue({
    remote: "https://git.example.com/notes.git",
    credentials: { type: "basic", username: "you", password },
  });
  actions.store.update({
    config: {
      ...defaults(),
      remote: "https://git.example.com/notes.git",
      username: "you",
      setupComplete: true,
    },
  });
  render(<SetupForm actions={actions} />);
  const input = screen.getByLabelText<HTMLInputElement>("Password or access token");
  expect(input.value).toBe("*".repeat(password.length));
  expect(input.type).toBe("password");
  expect(input.disabled).toBe(true);
});
it("saves automatic sync preferences and disables delay controls in manual mode", async () => {
  const actions = setup();
  const user = userEvent.setup();
  render(<SetupForm actions={actions} />);
  await connect(user);
  await user.selectOptions(screen.getByLabelText("Send local changes after"), "10000");
  await user.selectOptions(screen.getByLabelText("Check for remote changes every"), "300000");
  expect(actions.store.getSnapshot().config).toMatchObject({
    autoSync: true,
    uploadDelay: 10000,
    remoteCheckInterval: 300000,
  });
  await user.click(screen.getByRole("switch", { name: "Sync automatically" }));
  expect(actions.store.getSnapshot().config.autoSync).toBe(false);
  expect(screen.getByLabelText<HTMLSelectElement>("Send local changes after").disabled).toBe(true);
  expect(screen.getByLabelText<HTMLSelectElement>("Check for remote changes every").disabled).toBe(
    true,
  );
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Sync now" }).disabled).toBe(false);
  expect([...document.querySelectorAll("h3")].map((h) => h.textContent)).toEqual([
    "Repository",
    "Sync and downloads",
    "Sync status",
    "Maintenance",
  ]);
});
it("offers storage presets and keeps the selection while on-demand downloads is off", async () => {
  const actions = setup();
  const user = userEvent.setup();
  render(<SetupForm actions={actions} />);
  const select = screen.getByRole<HTMLSelectElement>("combobox", { name: "Local storage limit" });
  expect([...select.options].map((option) => option.text)).toEqual([
    "50 MB",
    "100 MB",
    "500 MB",
    "1024 MB",
    "Unlimited",
  ]);
  for (const value of ["50", "500", "1024", "unlimited", "100"]) {
    await user.selectOptions(select, value);
    expect(actions.store.getSnapshot().config.storageMegabytes).toBe(
      value === "unlimited" ? value : Number(value),
    );
  }
  await user.click(screen.getByRole("switch", { name: "On-demand downloads" }));
  expect(
    screen.getByRole<HTMLSelectElement>("combobox", { name: "Local storage limit" }).disabled,
  ).toBe(true);
});

it("caps download choices after storage and lowers the saved maximum with storage", async () => {
  const actions = setup();
  const user = userEvent.setup();
  render(<SetupForm actions={actions} />);
  const storage = screen.getByRole<HTMLSelectElement>("combobox", { name: "Local storage limit" });
  const download = screen.getByRole<HTMLSelectElement>("combobox", { name: "Max download size" });
  expect(download.value).toBe("25");
  expect([...download.options].map((option) => option.text)).toEqual([
    "5 MB",
    "10 MB",
    "25 MB",
    "50 MB",
    "100 MB",
  ]);
  expect(storage.compareDocumentPosition(download) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await user.selectOptions(download, "100");
  await user.selectOptions(storage, "50");
  expect(download.value).toBe("50");
  expect(actions.store.getSnapshot().config.maxDownloadMegabytes).toBe(50);
  expect([...download.options].map((option) => option.value)).not.toContain("100");
  await user.selectOptions(storage, "unlimited");
  expect(download.value).toBe("50");
  await user.selectOptions(download, "100");
  expect(actions.store.getSnapshot().config.maxDownloadMegabytes).toBe(100);
});

it("offers unlimited downloads with unlimited storage and caps them when storage is lowered", async () => {
  const actions = setup();
  const user = userEvent.setup();
  render(<SetupForm actions={actions} />);
  const storage = screen.getByRole<HTMLSelectElement>("combobox", { name: "Local storage limit" });
  const download = screen.getByRole<HTMLSelectElement>("combobox", { name: "Max download size" });
  expect([...download.options].map((option) => option.value)).not.toContain("unlimited");
  await user.selectOptions(storage, "unlimited");
  await user.selectOptions(download, "unlimited");
  expect(actions.store.getSnapshot().config.maxDownloadMegabytes).toBe("unlimited");
  await user.selectOptions(storage, "500");
  expect(download.value).toBe("500");
  expect(actions.store.getSnapshot().config.maxDownloadMegabytes).toBe(500);
});

it("allows unlimited downloads when the storage setting is inactive", async () => {
  const actions = setup();
  const user = userEvent.setup();
  render(<SetupForm actions={actions} />);
  await user.click(screen.getByRole("switch", { name: "On-demand downloads" }));
  const download = screen.getByRole<HTMLSelectElement>("combobox", { name: "Max download size" });
  await user.selectOptions(download, "unlimited");
  expect(download.value).toBe("unlimited");
  await user.click(screen.getByRole("switch", { name: "On-demand downloads" }));
  expect(download.value).toBe("100");
});
