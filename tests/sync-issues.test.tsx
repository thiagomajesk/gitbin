import { act, cleanup, render, screen } from "@testing-library/react";
// @vitest-environment jsdom
import { Effect } from "effect";
import { afterEach, expect, it, vi } from "vitest";
import { defaults } from "../src/core/config";
import { SyncError } from "../src/core/errors";
import { currentMetadata } from "../src/core/metadata";
import { decodeJournal, parseStoredData } from "../src/core/storage-format";
import { createUiStore } from "../src/ui/store";
import { syncIssue } from "../src/ui/sync-issue";
import { SyncStatus } from "../src/ui/sync-status";

vi.mock("obsidian", () => ({ setTooltip: vi.fn() }));
afterEach(cleanup);
it.each([
  [{ vaultRoot: "personal", files: [], intents: [] }, "migration-required"],
  [
    {
      vaultRoot: "personal",
      metadata: { consolidationHash: null, appliedMigrations: ["future-migration"] },
    },
    "newer-format",
  ],
  [{ metadata: currentMetadata(), vaultRoot: "personal", files: "bad" }, "invalid-data"],
  [{ garbage: true }, "invalid-data"],
])("classifies saved data without changing it: %j", async (raw, expected) => {
  const before = JSON.stringify(raw);
  const result = await Effect.runPromise(
    decodeJournal(raw).pipe(
      Effect.match({
        onSuccess: () => null,
        onFailure: (error) =>
          syncIssue(new SyncError({ message: "Outer IO context", cause: error })),
      }),
    ),
  );
  expect(result?.kind).toBe(expected);
  expect(JSON.stringify(raw)).toBe(before);
});
function setup(code: "migration-required" | "newer-format" | "invalid-data") {
  const error = new SyncError({
    code,
    message: "Internal storage failure",
    detail: "Stored format: 1. Supported format: 2.",
  });
  const store = createUiStore({
    config: { ...defaults(), setupComplete: true },
    status: "Needs attention",
    error: error.message,
    issue: syncIssue(error),
  });
  const synchronize = vi.fn(async () => true);
  render(<SyncStatus actions={{ store, synchronize }} />);
  return { store, synchronize };
}
it("explains consolidation below the status without starting migration or sync", async () => {
  const view = setup("migration-required");
  expect(screen.getByRole("status").textContent).toBe("Migration required");
  const info = screen.getByText(/Sync is currently paused due to pending migrations/);
  expect(info.tagName).toBe("P");
  expect(screen.getByRole("status").getAttribute("aria-describedby")).toBe(info.id);
  expect(screen.getByRole("status").className).toBe("gitbin-status-warning");
  expect(screen.queryByText("Error")).toBeNull();
  expect(screen.queryByText("Technical details")).toBeNull();
  expect(screen.queryByRole("button", { name: "Review migration…" })).toBeNull();
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Sync now" }).disabled).toBe(true);
  expect(view.synchronize).not.toHaveBeenCalled();
  act(() => view.store.update({ error: null, status: "Synced", stale: false }));
  expect(screen.queryByText(/Sync is currently paused due to pending migrations/)).toBeNull();
});
it("explains newer formats below the status", () => {
  setup("newer-format");
  expect(screen.getByText(/Update the plugin/)).toBeTruthy();
  expect(screen.queryByText("Error")).toBeNull();
});
it("explains damaged data below the status without extra controls", () => {
  setup("invalid-data");
  expect(screen.getByText(/haven’t been changed/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Copy error details" })).toBeNull();
});

it("reports damaged JSON without including its contents in diagnostics", () => {
  try {
    parseStoredData("private vault contents");
    throw Error("Expected failure");
  } catch (error) {
    expect(syncIssue(error)?.kind).toBe("invalid-data");
    expect(syncIssue(error)?.details).not.toContain("private vault contents");
  }
});
