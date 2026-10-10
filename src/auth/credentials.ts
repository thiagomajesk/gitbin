import { Schema } from "effect";
import type { CredentialProvider } from "just-git";
import { credentialScope } from "./credential-decisions";
export const CredentialSchema = Schema.Struct({
  type: Schema.Literal("basic"),
  username: Schema.String,
  password: Schema.String,
});
export type Credentials = typeof CredentialSchema.Type;
export interface Authentication {
  readonly remote: string;
  readonly credentials: Credentials | null;
}
export function scopedCredentials(
  remote: string,
  credentials: Credentials | null,
): CredentialProvider {
  const expected = new URL(remote);
  return (requested) => {
    const url = new URL(requested);
    if (!credentialScope(expected.origin, expected.pathname, url.origin, url.pathname)) return null;
    return credentials;
  };
}
export function readCredentials(saved: string | null): Credentials | null {
  if (!saved) return null;
  if (!saved.startsWith("gitbin-auth-v1:"))
    throw new Error("Unsupported Gitbin credential format.");
  return Schema.decodeUnknownSync(CredentialSchema, { onExcessProperty: "error" })(
    JSON.parse(saved.slice("gitbin-auth-v1:".length)),
  );
}
export const storeCredentials = (credentials: Credentials): string =>
  "gitbin-auth-v1:" + JSON.stringify(credentials);
