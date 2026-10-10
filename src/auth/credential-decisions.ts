export type Credential = { type: "basic"; username: string; password: string };
export type SavedAuthentication = { remote: string; credentials: Credential | null };
export function credentialScope(
  expectedOrigin: string,
  expectedPath: string,
  origin: string,
  path: string,
): boolean {
  //@ verify
  //@ ensures \result === (expectedOrigin === origin && expectedPath === path)
  return expectedOrigin === origin && expectedPath === path;
}
export function matchingSavedCredentials(
  remote: string,
  username: string,
  saved: SavedAuthentication | null,
): Credential | null {
  //@ verify
  //@ ensures saved === null ==> \result === null
  //@ ensures saved !== null ==> saved.remote !== remote ==> \result === null
  //@ ensures saved !== null ==> saved.remote === remote ==> saved.credentials === null ==> \result === null
  //@ ensures saved !== null ==> saved.remote === remote ==> saved.credentials !== null ==> \result === (saved.credentials.username === username ? saved.credentials : null)
  if (saved === null) return null;
  if (saved.remote !== remote) return null;
  const credentials = saved.credentials;
  if (credentials === null) return null;
  return credentials.username === username ? credentials : null;
}
