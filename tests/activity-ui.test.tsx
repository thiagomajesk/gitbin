// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { defaults } from "../src/core/config";
import { ActivityPanel } from "../src/ui/activity-modal";
import { createUiStore } from "../src/ui/store";
import { SyncStatus } from "../src/ui/sync-status";

vi.mock("obsidian", () => ({
  Modal: class {},
  apiVersion: "1.13.1",
  Platform: { isMobile: false },
  setTooltip: vi.fn(),
}));
afterEach(cleanup);
function store() {
  return createUiStore({
    config: {
      ...defaults(),
      setupComplete: true,
      remote: "https://private.test",
      secretId: "secret",
    },
    status: "Syncing…",
    error: null,
  });
}
it("places an accessible log button beside status and shows actual progress", () => {
  const state = store();
  const showLog = vi.fn();
  render(<SyncStatus actions={{ store: state, synchronize: async () => true, showLog }} />);
  act(() => state.update({ phase: "Checking remote changes…" }));
  expect(screen.getByRole("status").textContent).toBe("Checking remote changes…");
  const button = screen.getByRole("button", { name: "View sync log" });
  expect(button.parentElement).toBe(screen.getByRole("status").parentElement);
  fireEvent.click(button);
  expect(showLog).toHaveBeenCalledOnce();
});
it("updates an open log and copies only selected diagnostic fields", async () => {
  const state = store();
  const writeText = vi.fn(async (_text: string) => {});
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  render(<ActivityPanel store={state} version="0.0.4" />);
  expect(screen.getByText(/No activity yet/)).toBeTruthy();
  act(() =>
    state.update({
      activity: [{ id: "first", time: 1, level: "error", message: "Branch protected" }],
    }),
  );
  expect(screen.getByText("Branch protected")).toBeTruthy();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" })));
  const copied = writeText.mock.calls[0]?.[0] ?? "";
  expect(copied).toContain("Branch protected");
  expect(copied).toContain("storageMegabytes");
  expect(copied).not.toContain("private.test");
  expect(copied).not.toContain("secret");
  expect(screen.getByText("Diagnostics copied")).toBeTruthy();
});

it("renders a flat log with a timestamp per entry and no metadata", () => {
  const state = store();
  state.update({
    activity: [
      {
        id: "sync",
        time: 1,
        level: "success",
        message: "Sync completed",
        details: "Duration: 1.0 s",
      },
      { id: "check", time: 2, level: "info", message: "Checked remote" },
      {
        id: "pending",
        time: 3,

        level: "warning",
        message: "Still pending",
        details: "One file",
      },
      { id: "error", time: 4, level: "error", message: "Rejected" },
    ],
  });
  const view = render(<ActivityPanel store={state} version="0.0.4" />);
  expect(view.container.querySelectorAll("time")).toHaveLength(4);
  for (const level of ["Info", "Success", "Warning", "Error"])
    expect(screen.getByRole("img", { name: level }).textContent).toBe("");
  expect(screen.queryByText("One file")).toBeNull();
  expect(screen.queryByText("Duration: 1.0 s")).toBeNull();
  expect(screen.getByRole("button", { name: "Copy diagnostics" }).textContent).toBe("");
  expect(view.container.querySelectorAll(".gitbin-activity-log > li")).toHaveLength(4);
  expect(view.container.querySelector("ol ol")).toBeNull();
});
