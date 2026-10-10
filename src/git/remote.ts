import { attempt } from "../core/errors";
import { contentCatalog } from "./catalog";
import { consolidation } from "./consolidation";
import { allowedRemote } from "./remote-policy";
import { type Connection, gitSession } from "./session";
export function checkRemote(remote: string): void {
  const url = new URL(remote);
  if (!allowedRemote(url, /\s/.test(remote)))
    throw new Error(
      "Use the repository's HTTPS URL without a token. SSH and local paths are not supported.",
    );
}
export function createGitRemote(connection: Connection) {
  return attempt("Cannot initialize the Git remote.", () => {
    checkRemote(connection.url);
    const session = gitSession(connection);
    return {
      catalog: contentCatalog(session),
      maintenance: consolidation(connection),
    };
  });
}
