import type GitbinPlugin from "../main";
import type { SetupActions } from "./setup-types";
export const pluginActions = (plugin: GitbinPlugin): SetupActions => ({
  store: plugin.ui,
  saveSyncPreferences: (preferences) => plugin.saveSyncPreferences(preferences),
  vaultName: plugin.app.vault.getName(),
  scanToSync: () => plugin.scanToSync(),
  consolidate: () => plugin.consolidate(),
  reinitialize: () => plugin.reinitialize(),
  savedAuthentication: () => plugin.savedAuthentication(),
  disconnect: () => plugin.disconnect(),
  inspect: (connection) => plugin.inspectRepository(connection),
  finish: (config, authentication) => plugin.finishSetup(config, authentication),
  synchronize: () => plugin.manualSync(),
});
