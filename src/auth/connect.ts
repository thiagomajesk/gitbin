import type { SyncPreferences } from "../core/config";
import { checkRoot, validateVaults } from "../core/protocol";
import type { Authentication } from "./credentials";
import type { SetupActions, RepositoryInspection } from "../ui/setup-types";
function vaultConfig(
  actions: SetupActions,
  authentication: Authentication,
  inspection: RepositoryInspection,
  username: string,
  commitEmail: string,
) {
  const root = actions.vaultName;
  if (!checkRoot(root) || root.includes("/"))
    throw new Error(
      "This vault’s name cannot be used as a repository folder. Rename the vault before connecting.",
    );
  validateVaults([
    ...inspection.vaults.filter((vault) => vault.root !== root),
    { root, name: root },
  ]);
  const config = {
    ...actions.store.getSnapshot().config,
    remote: authentication.remote,
    username,
    commitEmail,
    root,
  };
  return config;
}

export async function establishConnection(
  actions: SetupActions,
  authentication: Authentication,
  username: string,
  commitEmail: string,
  preferences?: SyncPreferences,
) {
  if (actions.store.getSnapshot().config.setupComplete)
    throw new Error("Disconnect this vault before importing another connection.");
  const inspection = await actions.inspect(authentication);
  if (!inspection)
    throw new Error(
      actions.store.getSnapshot().error ??
        "Could not connect. Check repository access, then try again.",
    );
  const config = vaultConfig(actions, authentication, inspection, username, commitEmail);
  if (actions.store.getSnapshot().config.setupComplete)
    throw new Error("Disconnect this vault before importing another connection.");
  if (!(await actions.finish({ ...config, ...preferences }, authentication)))
    throw new Error(
      actions.store.getSnapshot().error ??
        "Connection could not finish. Your notes are preserved. Try again.",
    );
}
