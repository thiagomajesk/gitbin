// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { defaults } from "../src/core/config";
import { SyncStatus } from "../src/ui/sync-status";
import type { HistorySelection } from "../src/ui/sync-history";
import { FileHistory } from "../src/ui/file-history";
import { HistoryPanel } from "../src/ui/history-panel";
import { createUiStore } from "../src/ui/store";
import { emptyHistory, recordHistory, type FileSnapshot } from "../src/core/history";
vi.mock("obsidian", () => ({ setTooltip: vi.fn() }));

vi.mock("@pierre/diffs/react", () => ({
  Virtualizer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useVirtualizer: () => ({ scrollTo, getOffsetInScrollContainer }),
  MultiFileDiff: ({
    oldFile,
    newFile,
  }: {
    oldFile: { contents: string } | null;
    newFile: { contents: string } | null;
  }) => (
    <div data-testid="pierre-diff">
      {oldFile?.contents} → {newFile?.contents}
    </div>
  ),
}));
const scrollTo = vi.fn();
const getOffsetInScrollContainer = vi.fn((_element: HTMLElement) => 72);
beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => cleanup());
it("opens the selected comparison without replacing the history list", async () => {
  const actions = setup();
  const file = (text: string): FileSnapshot => ({
    id: "list",
    path: "List.md",
    text,
    hash: text,
    binary: false,
  });
  const base = file("Buy milk");
  const initial = recordHistory(emptyHistory(), [base], [], [base], "first");
  const history = recordHistory(
    initial,
    [file("Buy oat milk")],
    [file("Buy milk and bread")],
    [file("Buy oat milk and bread")],
    "abcdef1234",
  );
  actions.store.update({
    config: { ...actions.store.getSnapshot().config, setupComplete: true },
    history: history.entries,
  });
  const openFile = vi.fn<(selection: HistorySelection) => void>();
  render(<HistoryPanel store={actions.store} openFile={openFile} />);
  const user = userEvent.setup();
  expect(document.querySelector("[aria-expanded]")).toBeNull();
  expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(1);
  expect(screen.getAllByText(/1 file synced/)).toHaveLength(2);
  const fileLink = screen.getAllByRole("link", { name: "List.md" })[0];
  if (!fileLink) throw new Error("Missing file link");
  await user.click(fileLink);
  const selection = openFile.mock.calls[0]?.[0];
  if (!selection) throw new Error("Missing selected comparison");
  expect(selection.entry.revision).toBe("abcdef1234");
  render(<FileHistory selection={selection} />);
  expect(screen.getByRole("heading", { name: "Local" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Remote" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Final" })).toBeTruthy();
  expect(screen.getByRole("img", { name: "1 lines added, 1 lines removed" })).toBeTruthy();
  expect(screen.getAllByTestId("pierre-diff").map((el) => el.textContent)).toEqual([
    "Buy milk → Buy oat milk",
    "Buy milk → Buy milk and bread",
    "Buy milk → Buy oat milk and bread",
  ]);
  expect(screen.getAllByText(/1 file synced/)).toHaveLength(2);
  expect(screen.getByRole("region", { name: "Sync changes" }).textContent).toContain(
    "Buy oat milk and bread",
  );
  expect(screen.queryByText("Vaults")).toBeNull();
  expect(screen.queryByRole("button", { name: "Sync history" })).toBeNull();
  expect(screen.getAllByRole("link", { name: "List.md" })).toHaveLength(2);
});
it("opens the whole sync from the eye button and scrolls to a selected file", async () => {
  const actions = setup();
  const files: FileSnapshot[] = ["First.md", "Second.md"].map((path) => ({
    id: path,
    path,
    text: path,
    hash: path,
    binary: false,
  }));
  const history = recordHistory(emptyHistory(), files, [], files, "first");
  actions.store.update({ history: history.entries });
  const openFile = vi.fn<(selection: HistorySelection) => void>();
  render(<HistoryPanel store={actions.store} openFile={openFile} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "View sync changes" }));
  expect(openFile.mock.calls[0]?.[0].change).toBeNull();
  await user.click(screen.getByRole("link", { name: "Second.md" }));
  const selection = openFile.mock.calls[1]?.[0];
  if (!selection) throw new Error("Missing selected sync");
  expect(selection.change?.result.id).toBe("Second.md");
  scrollTo.mockClear();
  getOffsetInScrollContainer.mockClear();
  render(<FileHistory selection={selection} />);
  expect(screen.getAllByTestId("pierre-diff")).toHaveLength(4);
  await waitFor(() => {
    expect(scrollTo).toHaveBeenCalledWith({ top: 72 });
    expect(getOffsetInScrollContainer.mock.calls.at(-1)?.[0]).toBe(
      screen.getByRole("region", { name: "Second.md" }),
    );
  });
});
function setup() {
  const config = { ...defaults(), remote: "https://github.com/you/notes.git" };
  const store = createUiStore({ config, status: "Ready", error: null });
  const synchronize = vi.fn(async () => true);
  return { store, synchronize };
}

it("orders files alphabetically and highlights every literal search match without filtering", async () => {
  const actions = setup();
  const files: FileSnapshot[] = ["Zeta[guide][guide].md", "Beta[Guide].md", "Alpha.md"].map(
    (path) => ({
      id: path,
      path,
      text: path,
      hash: path,
      binary: false,
    }),
  );
  const history = recordHistory(emptyHistory(), files, files, files, "first");
  actions.store.update({ history: history.entries });
  render(<HistoryPanel store={actions.store} openFile={vi.fn()} />);
  expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual([
    "Alpha.md",
    "Beta[Guide].md",
    "Zeta[guide][guide].md",
  ]);
  const user = userEvent.setup();
  const search = screen.getByRole("searchbox", { name: "Search sync history" });
  await user.click(search);
  await user.paste("[guide]");
  await waitFor(() => expect(document.querySelectorAll("mark")).toHaveLength(3));
  expect(screen.getAllByRole("link")).toHaveLength(3);
  await user.clear(search);
  await waitFor(() => expect(document.querySelectorAll("mark")).toHaveLength(0));
});

describe("sync status", () => {
  it("shows available changes and changes verified status to cached status", () => {
    const actions = setup();
    const vault = {
      root: "personal",
      name: "Personal",
    };
    actions.store.update({
      config: { ...actions.store.getSnapshot().config, setupComplete: true },
      vaults: [
        { vault, latest: "abcdef123456", applied: "123456abcdef", changed: true, connected: true },
      ],
      stale: false,
    });
    render(<SyncStatus actions={actions} />);
    expect(screen.getByText("Files waiting to sync")).toBeTruthy();
    expect(screen.getByText("abcdef12")).toBeTruthy();
    act(() => actions.store.update({ stale: true }));
    expect(screen.getByText("Last known state")).toBeTruthy();
    expect(screen.queryByText("All changes synced")).toBeNull();
  });
});

it("shows only empty history without setup or dashboard controls", () => {
  const actions = setup();
  render(<HistoryPanel store={actions.store} openFile={vi.fn()} />);
  expect(screen.getByText(/No sync history yet/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Settings" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Sync now" })).toBeNull();
  expect(screen.queryByRole("textbox", { name: "Repository URL" })).toBeNull();
});

function historySelection(before: FileSnapshot, after: FileSnapshot): HistorySelection {
  const initial = recordHistory(emptyHistory(), [before], [], [before], "first");
  const state = recordHistory(initial, [before], [after], [after], "second");
  const entry = state.entries[0];
  if (!entry) throw new Error("Missing history entry");
  return { entry, change: entry.changes[0] ?? null };
}

it.each(["Images/Diagram.png", "Documents/Guide.pdf", "Audio/Recording.mp3"])(
  "skips text comparison and line counts for binary %s",
  (path) => {
    const before: FileSnapshot = { id: path, path, text: null, hash: "before", binary: true };
    const after: FileSnapshot = { ...before, hash: "after" };
    render(<FileHistory selection={historySelection(before, after)} />);
    expect(screen.getByRole("heading", { name: path })).toBeTruthy();
    expect(screen.getByText("Binary file. No preview available.")).toBeTruthy();
    expect(screen.queryByTestId("pierre-diff")).toBeNull();
    expect(document.querySelector(".gitbin-diff-counts")).toBeNull();
    for (const name of ["Local", "Remote", "Final"])
      expect(screen.queryByRole("heading", { name })).toBeNull();
  },
);

it("keeps binary additions, replacements and removals in alphabetical history with accurate states", () => {
  const file = (id: string, path: string | null, hash: string): FileSnapshot => ({
    id,
    path,
    text: null,
    hash,
    binary: true,
  });
  const baseline = [
    file("changed", "Image.png", "old-image"),
    file("removed", "Video.mp4", "video"),
  ];
  const initial = recordHistory(emptyHistory(), baseline, baseline, baseline, "first");
  const result = [
    file("removed", null, "video"),
    file("changed", "Image.png", "new-image"),
    file("added", "Document.pdf", "document"),
  ];
  const history = recordHistory(initial, baseline, result, result, "second");
  const entry = history.entries[0];
  if (!entry) throw new Error("Missing binary history entry");
  const actions = setup();
  actions.store.update({ history: [entry] });
  render(<HistoryPanel store={actions.store} openFile={vi.fn()} />);
  expect(screen.getByText("3 files synced")).toBeTruthy();
  expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual([
    "Document.pdf",
    "Image.png",
    "Video.mp4",
  ]);
  for (const [name, status] of [
    ["Document.pdf", "Added"],
    ["Image.png", "Changed"],
    ["Video.mp4", "Removed"],
  ] as const) {
    const icon = screen.getByRole("link", { name })?.closest("li")?.querySelector('[role="img"]');
    const labelId = icon?.getAttribute("aria-labelledby");
    expect(labelId ? document.getElementById(labelId)?.textContent : null).toBe(status);
  }
});

it("shows only Final when local, remote, and final versions are identical", () => {
  const file: FileSnapshot = {
    id: "same",
    path: "Daily.md",
    text: "Review types.",
    hash: "same",
    binary: false,
  };
  const history = recordHistory(emptyHistory(), [file], [file], [file], "first");
  const entry = history.entries[0];
  if (!entry) throw new Error("Missing history entry");
  render(<FileHistory selection={{ entry, change: entry.changes[0] ?? null }} />);
  expect(screen.queryByRole("heading", { name: "Local" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Remote" })).toBeNull();
  expect(screen.getByRole("heading", { name: "Final" })).toBeTruthy();
  expect(screen.getAllByTestId("pierre-diff")).toHaveLength(1);
});

it("lets users expand and collapse a large added file", async () => {
  const text = Array.from({ length: 51 }, (_, index) => `Line ${index}`).join("\n");
  const file: FileSnapshot = { id: "large", path: "Large.md", text, hash: "large", binary: false };
  const history = recordHistory(emptyHistory(), [file], [file], [file], "first");
  const entry = history.entries[0];
  if (!entry) throw new Error("Missing history entry");
  render(<FileHistory selection={{ entry, change: entry.changes[0] ?? null }} />);
  const user = userEvent.setup();
  expect(
    screen.getByRole("button", { name: "Expand Final diff" }).getAttribute("aria-expanded"),
  ).toBe("false");
  await user.click(screen.getByRole("button", { name: "Expand Final diff" }));
  expect(
    screen.getByRole("button", { name: "Collapse Final diff" }).getAttribute("aria-expanded"),
  ).toBe("true");
  await user.click(screen.getByRole("button", { name: "Collapse Final diff" }));
  expect(
    screen.getByRole("button", { name: "Expand Final diff" }).getAttribute("aria-expanded"),
  ).toBe("false");
  expect(screen.getByTestId("pierre-diff").textContent).toContain("Line 50");
});

it("keeps a 50-line diff fully visible without a fold control", () => {
  const text = Array.from({ length: 50 }, (_, index) => `Line ${index}`).join("\n");
  const file: FileSnapshot = { id: "fifty", path: "Fifty.md", text, hash: "fifty", binary: false };
  const history = recordHistory(emptyHistory(), [file], [file], [file], "first");
  const entry = history.entries[0];
  if (!entry) throw new Error("Missing history entry");
  render(<FileHistory selection={{ entry, change: entry.changes[0] ?? null }} />);
  expect(screen.queryByRole("button", { name: "Expand Final diff" })).toBeNull();
  expect(screen.getByTestId("pierre-diff").textContent).toContain("Line 49");
});

it("shows moved paths instead of empty panels for an unchanged file", () => {
  const before: FileSnapshot = {
    id: "moved",
    path: "getting-started/Guide.md",
    text: "Contents",
    hash: "same",
    binary: false,
  };
  const after = { ...before, path: "Guides/Guide.md" };
  render(<FileHistory selection={historySelection(before, after)} />);
  expect(
    screen.getByRole("heading", { name: "getting-started/Guide.md → Guides/Guide.md" }),
  ).toBeTruthy();
  expect(screen.getByText("File moved, contents unchanged.")).toBeTruthy();
  expect(screen.queryByTestId("pierre-diff")).toBeNull();
  expect(document.querySelector(".gitbin-diff-counts")).toBeNull();
});

it("keeps failed manual sync available for retry without reporting success", async () => {
  const actions = setup();
  actions.store.update({ config: { ...actions.store.getSnapshot().config, setupComplete: true } });
  actions.synchronize.mockResolvedValueOnce(false);
  render(<SyncStatus actions={actions} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Sync now" }));
  expect(screen.getByText(/could not finish/)).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe("Last sync failed");
  expect((screen.getByRole("button", { name: "Sync now" }) as HTMLButtonElement).disabled).toBe(
    false,
  );
  await user.click(screen.getByRole("button", { name: "Sync now" }));
  expect(actions.synchronize).toHaveBeenCalledTimes(2);
  expect(screen.queryByText(/could not finish/)).toBeNull();
});

it("uses only added, removed, and changed icons, treating the first recorded files as added", () => {
  const file = (id: string, path: string | null, text: string): FileSnapshot => ({
    id,
    path,
    text,
    hash: text,
    binary: false,
  });
  const baseline = [file("removed", "Removed.md", "old"), file("changed", "Changed.md", "before")];
  const initial = recordHistory(emptyHistory(), baseline, [], baseline, "first");
  const result = [
    file("removed", null, ""),
    file("changed", "Changed.md", "after"),
    file("added", "Added.md", "new"),
  ];
  const history = recordHistory(initial, result, [], result, "second");
  const actions = setup();
  actions.store.update({ history: history.entries });
  render(<HistoryPanel store={actions.store} openFile={vi.fn()} />);
  for (const [name, state] of [
    ["Added.md", "Added"],
    ["Removed.md", "Removed"],
    ["Changed.md", "Changed"],
  ] as const) {
    const link = screen.getAllByRole("link", { name })[0];
    const icon = link?.closest("li")?.querySelector('[role="img"]');
    const labelId = icon?.getAttribute("aria-labelledby");
    expect(labelId ? document.getElementById(labelId)?.textContent : null).toBe(state);
  }
  expect(screen.getAllByRole("img", { name: "Added" })).toHaveLength(3);
  expect(screen.queryByRole("img", { name: "Synced" })).toBeNull();
  for (const icon of document.querySelectorAll(".gitbin-file-state")) {
    expect(icon.querySelector("span")?.className).toBe("gitbin:sr-only");
    expect(icon.getAttribute("aria-label")).toBeNull();
    expect(icon.getAttribute("title")).toBeNull();
  }
});
