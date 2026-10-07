import { NetworkError } from "../core/errors";
import {
  createGit,
  MemoryFileSystem,
  type FileSystem,
  type NetworkPolicy,
  type CredentialProvider,
  type GitContext,
} from "just-git";
import { resolveRef, fetchObjects } from "just-git/repo";
export interface Connection {
  readonly url: string;
  readonly network: NetworkPolicy & { readonly fetch: NonNullable<NetworkPolicy["fetch"]> };
  readonly credentials: CredentialProvider;
  readonly identity: {
    readonly author: { readonly name: string; readonly email: string };
    readonly device: string;
  };
  readonly fs?: FileSystem;
}
export function gitSession(connection: Connection) {
  const fs = connection.fs ?? new MemoryFileSystem();
  const cwd = "/repo";
  let networkFailure: NetworkError | undefined;
  const network: NetworkPolicy = {
    ...connection.network,
    fetch: async (input, init) => {
      try {
        const response = await connection.network.fetch(input, init);
        if (!response.ok)
          networkFailure = new NetworkError({
            message: "Repository HTTP " + response.status,
            retryable: [408, 425, 429].includes(response.status) || response.status >= 500,
          });
        return response;
      } catch (cause) {
        networkFailure = new NetworkError({
          message: "Repository connection failed.",
          retryable: true,
          cause,
        });
        throw networkFailure;
      }
    },
  };
  const client = createGit({
    fs,
    cwd,
    network,
    credentials: connection.credentials,
    identity: { name: "Gitbin", email: `gitbin@${connection.identity.device}`, locked: true },
  });
  const run = async (args: string[]) => {
    networkFailure = undefined;
    const result = await client.execute(args, { fs, cwd, env: new Map(), stdin: "" });
    if (result.exitCode !== 0)
      throw networkFailure ?? new Error(result.stderr || "Git operation failed.");
    return result;
  };
  let ready = false;
  const repo = async () => {
    if (!ready) {
      await fs.mkdir(cwd, { recursive: true });
      if (!(await client.findRepo())) {
        await run(["init", "-b", "main"]);
      }
      await run(["config", "remote.origin.url", connection.url]);
      await run(["config", "remote.origin.fetch", "+refs/heads/main:refs/remotes/origin/main"]);
      ready = true;
    }
    const value = await client.findRepo();
    if (!value) throw new Error("Cannot open private Git cache.");
    return value;
  };
  const fetch = async () => {
    const value = await repo();
    const cached = await resolveRef(value, "refs/remotes/origin/main");
    const fetchHead = cwd + "/.git/FETCH_HEAD";
    await fs.rm(fetchHead, { force: true });
    await run([
      "fetch",
      ...(cached ? [] : ["--depth", "1"]),
      "--filter=blob:none",
      "--no-tags",
      "--prune",
      "origin",
    ]);
    const hasBranches = await fs.exists(fetchHead);
    if (!hasBranches) await value.refStore.deleteRef("refs/remotes/origin/main");
    return {
      repo: value,
      revision: await resolveRef(value, "refs/remotes/origin/main"),
      hasBranches,
    };
  };
  const hydrate = async (value: GitContext, hashes: readonly string[]) => {
    networkFailure = undefined;
    try {
      return await fetchObjects(value, hashes);
    } catch (error) {
      throw networkFailure ?? error;
    }
  };
  return { repo, fetch, run, hydrate };
}
