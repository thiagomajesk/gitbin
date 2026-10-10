import {
  type CredentialProvider,
  createGit,
  type FileSystem,
  type GitContext,
  MemoryFileSystem,
  type NetworkPolicy,
} from "just-git";
import { fetchObjects, resolveRef } from "just-git/repo";
import { NetworkError } from "../core/errors";
import { checkPushLease } from "./push-lease";
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
  let pushLease: string | undefined;
  const network: NetworkPolicy = {
    ...connection.network,
    fetch: async (input, init) => {
      try {
        const response = await connection.network.fetch(input, init);
        if (
          pushLease &&
          (input instanceof Request ? input.url : String(input)).includes(
            "service=git-receive-pack",
          ) &&
          response.ok
        )
          await checkPushLease(response, pushLease);
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
  const pushConsolidation = async (expected: string) => {
    pushLease = expected;
    try {
      await run(["push", "--force", "origin", "refs/heads/main:refs/heads/main"]);
    } finally {
      pushLease = undefined;
    }
  };
  const clear = async () => {
    await fs.rm(cwd, { recursive: true, force: true });
    ready = false;
  };
  const release = async (hash: string) => {
    if (!/^[a-f0-9]{40}$/.test(hash)) throw new Error("Invalid cache object identity.");
    const value = await repo();
    await fs.rm(`${cwd}/.git/objects/${hash.slice(0, 2)}/${hash.slice(2)}`, { force: true });
    const directory = cwd + "/.git/objects/pack";
    if (!(await fs.exists(directory))) return;
    try {
      for (const name of await fs.readdir(directory)) {
        if (!name.endsWith(".idx")) continue;
        const path = directory + "/" + name;
        if ((await fs.stat(path)).size > 4096) continue;
        const bytes = await fs.readFileBuffer(path);
        if (!singletonPack(bytes, hash)) continue;
        await fs.rm(path, { force: true });
        await fs.rm(path.slice(0, -4) + ".pack", { force: true });
      }
    } finally {
      value.objectStore.invalidatePacks?.();
    }
  };
  return { repo, fetch, run, hydrate, pushConsolidation, release, clear };
}

function singletonPack(bytes: Uint8Array, hash: string): boolean {
  if (bytes.length < 1052) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const identity = [...bytes.subarray(1032, 1052)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return (
    view.getUint32(0) === 0xff744f63 &&
    view.getUint32(4) === 2 &&
    view.getUint32(1028) === 1 &&
    identity === hash
  );
}
