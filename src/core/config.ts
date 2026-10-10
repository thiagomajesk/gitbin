import { Schema } from "effect";
import { cappedDownloadLimit } from "./download-decisions";
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
  storageMegabytes: Schema.Union([
    Schema.Literal("unlimited"),
    Schema.Number.check(
      Schema.isInt(),
      Schema.isGreaterThanOrEqualTo(1),
      Schema.isLessThanOrEqualTo(8589934591),
    ),
  ]),
  maxDownloadMegabytes: Schema.Union([
    Schema.Literal("unlimited"),
    Schema.Number.check(
      Schema.isInt(),
      Schema.isGreaterThanOrEqualTo(1),
      Schema.isLessThanOrEqualTo(8589934591),
    ),
  ]),
  downloadMode: Schema.Literals(["on-demand", "all"]),
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
export type SyncPreferences = Pick<
  Config,
  | "autoSync"
  | "uploadDelay"
  | "remoteCheckInterval"
  | "storageMegabytes"
  | "downloadMode"
  | "maxDownloadMegabytes"
>;
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
  storageMegabytes: 100,
  maxDownloadMegabytes: 25,
  downloadMode: "on-demand",
  lastRevision: null,
  lastSync: null,
  pending: false,
  checkedAt: null,
  vaults: [],
});

export function loadConfig(raw: unknown): Config {
  if (raw === null || raw === undefined) return defaults();
  const values = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(raw);
  const config = Schema.decodeUnknownSync(ConfigSchema, { onExcessProperty: "error" })({
    maxDownloadMegabytes: 25,
    downloadMode: "on-demand",
    ...values,
    storageMegabytes:
      values.storageMegabytes === 0 ? "unlimited" : (values.storageMegabytes ?? 100),
  });
  return {
    ...config,
    maxDownloadMegabytes: downloadLimit(config),
  };
}

export function downloadLimit(config: SyncPreferences): Config["maxDownloadMegabytes"] {
  const limit = cappedDownloadLimit(
    config.maxDownloadMegabytes === "unlimited" ? 0 : config.maxDownloadMegabytes,
    config.downloadMode === "all" || config.storageMegabytes === "unlimited"
      ? 0
      : config.storageMegabytes,
  );
  return limit === 0 ? "unlimited" : limit;
}
