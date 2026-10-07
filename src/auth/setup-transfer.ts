import { Schema } from "effect";
import { CredentialSchema } from "./credentials";
import { CommitEmail, SyncPreferencesSchema, type Config } from "../core/config";
import type { Authentication } from "./credentials";
import { checkRoot } from "../core/protocol";
import { checkRemote } from "../git/remote";
import { establishConnection } from "./connect";
import type { SetupActions } from "../ui/setup-types";

const SetupSchema = Schema.Struct({
  version: Schema.Literal(1),
  remote: Schema.NonEmptyString,
  root: Schema.NonEmptyString,
  credentials: Schema.NullOr(CredentialSchema),
  commitEmail: CommitEmail,
  settings: SyncPreferencesSchema,
});
export type SyncSetupPayload = typeof SetupSchema.Type;

export function exportSetup(
  config: Config,
  authentication: Authentication | null,
): SyncSetupPayload {
  if (!config.setupComplete) throw new Error("Connect this vault before sharing its setup.");
  if (config.secretId && !authentication?.credentials)
    throw new Error("The saved Git credential is unavailable.");
  const { remote, root, commitEmail, autoSync, uploadDelay, remoteCheckInterval } = config;
  return decodeSetup({
    version: 1,
    remote,
    root,
    commitEmail,
    credentials: authentication?.credentials ?? null,
    settings: { autoSync, uploadDelay, remoteCheckInterval },
  });
}

export function checkSetupTarget(actions: SetupActions, payload: SyncSetupPayload): void {
  if (actions.store.getSnapshot().config.setupComplete)
    throw new Error("Disconnect this vault before importing another connection.");
  if (actions.vaultName !== payload.root)
    throw new Error("Open a vault with the same name as the desktop vault, then scan again.");
}

function validate(input: unknown): SyncSetupPayload {
  const payload = Schema.decodeUnknownSync(SetupSchema, { onExcessProperty: "error" })(input);
  checkRemote(payload.remote);
  if (
    !checkRoot(payload.root) ||
    payload.root.includes("/") ||
    payload.root !== payload.root.trim()
  )
    throw new Error("Invalid vault name.");
  if (
    payload.credentials &&
    (!payload.credentials.username.trim() || !payload.credentials.password)
  )
    throw new Error("Incomplete credentials.");
  return payload;
}

export function decodeSetup(input: unknown): SyncSetupPayload {
  try {
    return validate(input);
  } catch {
    throw new Error("Invalid or unsupported setup code. Generate a new QR code on your desktop.");
  }
}
export async function importSetup(actions: SetupActions, input: SyncSetupPayload): Promise<void> {
  const payload = validate(input);
  checkSetupTarget(actions, payload);
  await establishConnection(
    actions,
    { remote: payload.remote, credentials: payload.credentials },
    payload.credentials?.username ?? "",
    payload.commitEmail,
    payload.settings,
  );
}
