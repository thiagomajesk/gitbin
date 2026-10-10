import { Schema } from "effect";
import { Registration } from "./protocol";

export const CommitEmail = Schema.String.check(Schema.isPattern(/^(?:|[^\s<>@]+@[^\s<>@]+)$/));

export const SyncPreferencesSchema = Schema.Struct({
  autoSync: Schema.Boolean,
  uploadDelay: Schema.Literals([5000, 10000, 15000, 30000, 60000]),
  remoteCheckInterval: Schema.Literals([60000, 300000, 600000, 900000]),
});

const ConfigSchema = Schema.Struct({
  remote: Schema.String,
  root: Schema.String,
  username: Schema.String,
  commitEmail: CommitEmail,
  secretId: Schema.String,
  setupComplete: Schema.Boolean,
  connectedAt: Schema.Number,
  ...SyncPreferencesSchema.fields,
  lastRevision: Schema.NullOr(Schema.String),
  lastSync: Schema.NullOr(Schema.Number),
  pending: Schema.Boolean,
  checkedAt: Schema.NullOr(Schema.Number),
  vaults: Schema.Array(
    Schema.Struct({
      vault: Registration,
      latest: Schema.NullOr(Schema.String),
      applied: Schema.NullOr(Schema.String),
      changed: Schema.NullOr(Schema.Boolean),
      connected: Schema.Boolean,
    }),
  ),
});
export type Config = typeof ConfigSchema.Type;
export type SyncPreferences = Pick<Config, "autoSync" | "uploadDelay" | "remoteCheckInterval">;
export const defaults = (): Config => ({
  remote: "",
  root: "",
  username: "",
  commitEmail: "",
  secretId: "",
  setupComplete: false,
  connectedAt: Date.now(),
  autoSync: true,
  uploadDelay: 5000,
  remoteCheckInterval: 60000,
  lastRevision: null,
  lastSync: null,
  pending: false,
  checkedAt: null,
  vaults: [],
});

export function loadConfig(raw: unknown): Config {
  if (raw === null || raw === undefined) return defaults();
  return Schema.decodeUnknownSync(ConfigSchema, { onExcessProperty: "error" })(raw);
}
