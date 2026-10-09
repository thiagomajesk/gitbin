// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { ConsolidationModal } from "../src/ui/consolidation-modal";
import { ConsolidationPanel } from "../src/ui/consolidation-panel";
afterEach(cleanup);
const summary = {
  repository: "test repository",
  revision: "abc",
  vaults: ["personal", "work"],
  migrations: ["Binary references"],
};
it("requires explicit acknowledgement and cancel never publishes", async () => {
  const apply = vi.fn();
  const cancel = vi.fn();
  const user = userEvent.setup();
  render(<ConsolidationPanel summary={summary} apply={apply} cancel={cancel} />);
  expect((screen.getByRole("button", { name: "Consolidate" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(apply).not.toHaveBeenCalled();
  await user.click(screen.getByRole("checkbox", { name: /reviewed what/ }));
  expect((screen.getByRole("button", { name: "Consolidate" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  await user.click(screen.getByRole("checkbox", { name: /backed up everything/ }));
  expect((screen.getByRole("button", { name: "Consolidate" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  await user.click(screen.getByRole("checkbox", { name: /can’t be undone/ }));
  await user.click(screen.getByRole("button", { name: "Consolidate" }));
  expect(apply).toHaveBeenCalledTimes(1);
});
it("keeps failed consolidation visible", async () => {
  const user = userEvent.setup();
  const cancel = vi.fn();
  render(
    <ConsolidationPanel
      summary={summary}
      apply={async () => {
        throw new Error("Head changed");
      }}
      cancel={cancel}
    />,
  );
  for (const checkbox of screen.getAllByRole("checkbox")) await user.click(checkbox);
  await user.click(screen.getByRole("button", { name: "Consolidate" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("alert").textContent).toBe("Head changed");
  expect(cancel).not.toHaveBeenCalled();
});

vi.mock("obsidian", () => ({
  Modal: class {
    contentEl = document.createElement("div");
    modalEl = document.createElement("div");
    constructor() {
      document.body.append(this.contentEl);
    }
    setTitle() {}
    onClose() {}
    close() {
      this.onClose();
      this.contentEl.remove();
    }
  },
}));
it("keeps the modal open while publication is in flight", async () => {
  let finish = () => {};
  const operation = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const closed = vi.fn();
  const modal = new ConsolidationModal({} as App, summary, () => operation, closed);
  await act(async () => {
    modal.onOpen();
  });
  const user = userEvent.setup();
  for (const checkbox of screen.getAllByRole("checkbox")) await user.click(checkbox);
  await user.click(screen.getByRole("button", { name: "Consolidate" }));
  modal.close();
  expect(closed).not.toHaveBeenCalled();
  await act(async () => {
    finish();
    await operation;
  });
  expect(closed).toHaveBeenCalledTimes(1);
});

it("explains repair and requires acknowledgement before reinitializing", async () => {
  const apply = vi.fn();
  const user = userEvent.setup();
  render(
    <ConsolidationPanel
      summary={{ ...summary, reinitialize: true }}
      apply={apply}
      cancel={() => {}}
    />,
  );
  const button = screen.getByRole("button", {
    name: "Reinitialize",
  }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(screen.getByText(/Use this when damaged metadata/).textContent).toContain(
    "latest committed files",
  );
  expect(screen.queryByText("Repository")).toBeNull();
  expect(screen.queryByText("Affected vaults")).toBeNull();
  expect(document.querySelector("details")).toBeNull();
  for (const checkbox of screen.getAllByRole("checkbox")) await user.click(checkbox);
  await user.click(button);
  expect(apply).toHaveBeenCalledTimes(1);
});

it("opening and cancelling the dialog never starts maintenance", async () => {
  const apply = vi.fn();
  const closed = vi.fn();
  const modal = new ConsolidationModal(
    {} as App,
    { reinitialize: true, vaults: ["personal"] },
    apply,
    closed,
  );
  await act(async () => modal.onOpen());
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  expect(apply).not.toHaveBeenCalled();
  const user = userEvent.setup();
  for (const checkbox of screen.getAllByRole("checkbox")) await user.click(checkbox);
  expect(apply).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(apply).not.toHaveBeenCalled();
  expect(closed).toHaveBeenCalledTimes(1);
});

it("shows live progress only during a confirmed operation and prevents dismissal", async () => {
  let finish = () => {};
  let report = (_message: string) => {};
  const operation = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const apply = vi.fn(async (update: (message: string) => void) => {
    report = update;
    update("Fetching repository…");
    await operation;
  });
  const cancel = vi.fn();
  render(
    <ConsolidationPanel
      summary={{ reinitialize: true, vaults: ["personal"] }}
      apply={apply}
      cancel={cancel}
    />,
  );
  expect(screen.queryByRole("progressbar")).toBeNull();
  const user = userEvent.setup();
  for (const checkbox of screen.getAllByRole("checkbox")) await user.click(checkbox);
  await user.click(screen.getByRole("button", { name: "Reinitialize" }));
  expect(screen.getByRole("progressbar").hasAttribute("value")).toBe(false);
  expect(screen.getByRole("status").textContent).toBe("Fetching repository…");
  await act(async () => report("Publishing repository…"));
  expect(screen.getByRole("status").textContent).toBe("Publishing repository…");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(cancel).not.toHaveBeenCalled();
  await act(async () => {
    finish();
    await operation;
  });
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("progressbar")).toBeNull();
});
