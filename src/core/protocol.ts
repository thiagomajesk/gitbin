import { Effect, Schema } from "effect";
import { SyncError } from "./errors";
import { FileContent } from "./content";

const Id = Schema.String.check(Schema.isPattern(/^[a-f0-9-]{36}$/));
export const Registration = Schema.Struct({
  name: Schema.NonEmptyString,
  root: Schema.NonEmptyString,
});
export type Registration = typeof Registration.Type;
export const Location = Schema.Struct({
  path: Schema.NullOr(Schema.String),
  parents: Schema.Array(Id),
  contentHash: Schema.String,
});
export type Location = typeof Location.Type;
const StoredFile = Schema.Struct({
  id: Id,
  state: Schema.String,
  baselinePath: Schema.NullOr(Schema.String),
  baselineContent: Schema.NullOr(FileContent),
  baselineState: Schema.NullOr(Schema.String),
});
export type StoredFile = typeof StoredFile.Type;
const WriteIntent = Schema.Struct({
  path: Schema.String,
  before: Schema.NullOr(FileContent),
  after: Schema.NullOr(FileContent),
});
export type WriteIntent = typeof WriteIntent.Type;
export const Journal = Schema.Struct({
  vaultRoot: Schema.NonEmptyString,
  files: Schema.Array(StoredFile),
  intents: Schema.Array(WriteIntent),
});
export type Journal = typeof Journal.Type;

export const decode = <A>(schema: Schema.Codec<A>, input: unknown): Effect.Effect<A, SyncError> =>
  Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })(input).pipe(
    Effect.mapError(
      (cause) => new SyncError({ message: "Invalid or unsupported Gitbin data.", cause }),
    ),
  );

export function validPath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 1000 &&
    !Array.from(path).some((char) => char.charCodeAt(0) < 32) &&
    !/[\\:*?"<>|]/.test(path) &&
    path
      .split("/")
      .every(
        (part) =>
          part !== "" &&
          part !== "." &&
          part !== ".." &&
          !part.startsWith(".") &&
          !/[ .]$/.test(part) &&
          !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      )
  );
}

export const checkRoot = (root: string) =>
  validPath(root) && !root.toLowerCase().split("/").includes(".gitbin");

export function validateVaults(vaults: ReadonlyArray<Registration>): void {
  const roots: string[] = [];
  for (const vault of vaults) {
    if (!checkRoot(vault.root) || vault.root.includes("/"))
      throw new Error("Vault roots must be portable folder names.");
    const root = vault.root.toLowerCase();
    if (
      roots.some(
        (existing) =>
          existing === root || existing.startsWith(`${root}/`) || root.startsWith(`${existing}/`),
      )
    )
      throw new Error("Vault roots must be distinct and non-overlapping.");
    roots.push(root);
  }
}
