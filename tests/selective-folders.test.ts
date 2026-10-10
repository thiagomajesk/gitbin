import { it } from "@effect/vitest";
import { Effect } from "effect";
import type { App } from "obsidian";
import { expect, vi } from "vitest";
import { objectReference } from "../src/core/inventory";
import { SelectiveObsidianVault } from "../src/platform/selective-vault";

const cases = [
  { name: "empty ancestors", files: [], folders: [], removed: ["parent/child", "parent"] },
  { name: "hidden files", files: ["parent/child/.keep"], folders: [], removed: [] },
  { name: "local files", files: ["parent/child/local.md"], folders: [], removed: [] },
  { name: "other folders", files: [], folders: ["parent/child/local"], removed: [] },
];
for (const scenario of cases) {
  it.effect(`prunes only empty parents after deletion: ${scenario.name}`, () =>
    Effect.gen(function* () {
      const bytes = new TextEncoder().encode("saved");
      const trashFile = vi.fn(async () => {});
      const app = {
        vault: {
          getFileByPath: (path: string) => ({ path }),
          getFolderByPath: (path: string) => ({ path }),
          readBinary: async () => bytes.buffer,
          adapter: {
            stat: async () => ({ size: bytes.length }),
            list: async () => ({ files: scenario.files, folders: scenario.folders }),
          },
        },
        fileManager: { trashFile },
      } as unknown as App;
      const local = new SelectiveObsidianVault(
        app,
        "cache",
        () => false,
        () => {},
        () => {},
      );
      yield* local.write("parent/child/file.md", objectReference(bytes), null);
      expect(trashFile).toHaveBeenCalledWith({ path: "parent/child/file.md" });
      expect(trashFile.mock.calls.slice(1)).toEqual(scenario.removed.map((path) => [{ path }]));
    }),
  );
}
