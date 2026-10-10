import { attempt } from "../core/errors";
import { decodeInventory, inventoryPath } from "../core/inventory";
import { migrateDeviceInventory } from "./device-inventory";
import { addInventories } from "./inventory";
import { journalData } from "./metadata";
import type { StorageMigration } from "./types";
import { repositoryVaults } from "./validation";

export const contentInventoryMigration: StorageMigration = {
  id: "content-inventory",
  title: "Prepare selective downloads",
  inspect: (source) =>
    attempt("Cannot inspect content inventory.", () => ({
      status: (
        source.kind === "device"
          ? !("entries" in journalData(source))
          : repositoryVaults(source.files).some((root) => !source.files.has(inventoryPath(root)))
      )
        ? "needed"
        : "satisfied",
    })),
  transform: (source) =>
    attempt("Cannot build content inventory.", () =>
      source.kind === "device" ? migrateDeviceInventory(source) : addInventories(source),
    ),
  validate: (source) =>
    attempt("Invalid content inventory.", () => {
      if (source.kind === "device") return;
      for (const root of repositoryVaults(source.files)) {
        const bytes = source.files.get(inventoryPath(root));
        if (!bytes) throw new Error("Missing vault inventory.");
        decodeInventory(bytes, root);
      }
    }),
};
