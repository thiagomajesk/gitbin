import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { MemoryFileSystem } from "just-git";
import { afterEach, expect, it } from "vitest";
import { consolidation } from "../src/git/consolidation";
import { checkPushLease } from "../src/git/push-lease";
import { gitServer } from "./git-server";

const servers: Awaited<ReturnType<typeof gitServer>>[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});
function git(cwd: string, ...args: string[]) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", windowsHide: true }).trim();
}
async function fixture(corrupt = false) {
  const root = await mkdtemp(join(tmpdir(), "gitbin-consolidate-"));
  const remote = join(root, "remote.git");
  git(root, "init", "--bare", remote);
  git(remote, "config", "http.receivepack", "true");
  git(remote, "symbolic-ref", "HEAD", "refs/heads/main");
  const work = join(root, "work");
  git(root, "init", "-b", "main", work);
  git(work, "config", "user.name", "test");
  git(work, "config", "user.email", "test@example.com");
  await mkdir(join(work, ".gitbin"));
  await writeFile(join(work, ".gitbin/format"), "2\n");
  await writeFile(join(work, "keep.txt"), "first");
  git(work, "add", ".");
  git(work, "commit", "-m", "first");
  await writeFile(join(work, "keep.txt"), "latest");
  if (corrupt) {
    await mkdir(join(work, "personal"));
    await mkdir(join(work, "work"));
    await writeFile(join(work, "personal/Note.md"), "committed note");
    await writeFile(join(work, "personal/Image.bin"), new Uint8Array([0, 255, 42]));
    await writeFile(join(work, "work/Other.md"), "other vault");
    await writeFile(join(work, ".gitbin/metadata.json"), "{broken");
    await mkdir(join(work, ".gitbin/vaults/work/notes"), { recursive: true });
    await writeFile(join(work, ".gitbin/vaults/work/notes/broken.bin"), "corrupt state");
    git(work, "add", ".");
  }
  git(work, "commit", "-am", "latest");
  git(work, "remote", "add", "origin", remote);
  git(work, "push", "origin", "main");
  const server = await gitServer(root);
  servers.push(server);
  let race = false;
  const connection = {
    fs: new MemoryFileSystem(),
    url: server.url,
    credentials: () => null,
    identity: { author: { name: "test", email: "test@example.com" }, device: "test" },
    network: {
      allowed: ["http://127.0.0.1"],
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        if (
          race &&
          (input instanceof Request ? input.url : String(input)).includes(
            "service=git-receive-pack",
          )
        ) {
          race = false;
          await writeFile(join(work, "race.txt"), "concurrent");
          git(work, "add", ".");
          git(work, "commit", "-m", "race");
          git(work, "push", "origin", "main");
        }
        return fetch(input, init);
      },
    },
  };
  return {
    service: consolidation(connection),
    reopen: () => consolidation(connection),
    remote,
    work,
    race: () => {
      race = true;
    },
  };
}
it("preview is read-only and publication replaces main with exactly one current root", async () => {
  const f = await fixture();
  const original = git(f.remote, "rev-parse", "main");
  const preview = await Effect.runPromise(f.service.preview());
  expect(git(f.remote, "rev-parse", "main")).toBe(original);
  expect(git(f.remote, "rev-list", "--count", "main")).toBe("2");
  await Effect.runPromise(f.service.apply(preview.sourceRevision, preview.revision));
  expect(git(f.remote, "rev-list", "--count", "main")).toBe("1");
  expect(git(f.remote, "show", "main:keep.txt")).toBe("latest");
  await Effect.runPromise(f.service.apply(preview.sourceRevision, preview.revision));
  expect(git(f.remote, "rev-list", "--count", "main")).toBe("1");
});
it("rejects an update racing between final fetch and receive-pack advertisement", async () => {
  const f = await fixture();
  const preview = await Effect.runPromise(f.service.preview());
  f.race();
  await expect(
    Effect.runPromise(f.service.apply(preview.sourceRevision, preview.revision)),
  ).rejects.toThrow();
  expect(git(f.remote, "show", "main:race.txt")).toBe("concurrent");
  expect(git(f.remote, "rev-list", "--count", "main")).toBe("3");
});
it("checks the exact advertised branch head", async () => {
  const id = "a".repeat(40);
  await expect(
    checkPushLease(new Response("0040" + id + " refs/heads/main\0report-status\n"), id),
  ).resolves.toBeUndefined();
  await expect(
    checkPushLease(new Response("0040" + "b".repeat(40) + " refs/heads/main\n"), id),
  ).rejects.toThrow();
  await expect(checkPushLease(new Response("0000"), id)).rejects.toThrow();
});

it("reconciles completed publication after restart and subsequent compatible commits", async () => {
  const f = await fixture();
  const preview = await Effect.runPromise(f.service.preview());
  await Effect.runPromise(f.service.apply(preview.sourceRevision, preview.revision));
  git(f.work, "fetch", "origin");
  git(f.work, "reset", "--hard", "origin/main");
  await writeFile(join(f.work, "next.txt"), "later update");
  const metadata: unknown = JSON.parse(git(f.remote, "show", "main:.gitbin/metadata.json"));
  await writeFile(join(f.work, ".gitbin/metadata.json"), JSON.stringify(metadata, null, 2));
  git(f.work, "add", ".");
  git(f.work, "commit", "-m", "after consolidation");
  git(f.work, "push", "origin", "main");
  const current = git(f.remote, "rev-parse", "main");
  const restarted = f.reopen();
  expect(await Effect.runPromise(restarted.status(preview.sourceRevision, preview.revision))).toBe(
    "complete",
  );
  await Effect.runPromise(restarted.apply(preview.sourceRevision, preview.revision));
  expect(git(f.remote, "rev-parse", "main")).toBe(current);
  expect(git(f.remote, "rev-list", "--count", "main")).toBe("2");
});

it("treats a later consolidation as stale even if its files are otherwise unchanged", async () => {
  const f = await fixture();
  const first = await Effect.runPromise(f.service.preview());
  await Effect.runPromise(f.service.apply(first.sourceRevision, first.revision));
  const second = await Effect.runPromise(f.service.preview());
  expect(second.migrations).toEqual([]);
  expect(second.consolidationHash).not.toBe(first.consolidationHash);
  await Effect.runPromise(f.service.apply(second.sourceRevision, second.revision));
  expect(await Effect.runPromise(f.service.status(first.sourceRevision, first.revision))).toBe(
    "stale",
  );
  expect(git(f.remote, "rev-list", "--count", "main")).toBe("1");
});

it("reinitializes corrupt metadata and state without changing ordinary committed files", async () => {
  const f = await fixture(true);
  const original = git(f.remote, "rev-parse", "main");
  const ordinary = (revision: string) =>
    git(f.remote, "ls-tree", "-r", revision)
      .split("\n")
      .filter((line) => !line.split("\t")[1]?.startsWith(".gitbin/"));
  const before = ordinary("main");
  await expect(Effect.runPromise(f.service.preview())).rejects.toThrow();
  const preview = await Effect.runPromise(f.service.preview(null, ["personal"]));
  expect(git(f.remote, "rev-parse", "main")).toBe(original);
  expect(preview.vaults).toEqual(["personal", "work"]);
  await Effect.runPromise(f.service.apply(preview.sourceRevision, preview.revision));
  expect(ordinary("main")).toEqual(before);
  expect(git(f.remote, "rev-list", "--count", "main")).toBe("1");
  expect(git(f.remote, "log", "-1", "--format=%s")).toBe("gitbin: reinitialize repository");
  const paths = git(f.remote, "ls-tree", "-r", "--name-only", "main");
  expect(paths).not.toContain("broken.bin");
  expect(paths).not.toContain(".gitbin/format");
  expect(paths).toContain(".gitbin/vaults/personal/attachments/");
  expect(paths).toContain(".gitbin/vaults/work/notes/");
  expect((await Effect.runPromise(f.service.preview())).migrations).toEqual([]);
});
it("rejects concurrent publication during reinitialization", async () => {
  const f = await fixture(true);
  const preview = await Effect.runPromise(f.service.preview(null, ["personal"]));
  f.race();
  await expect(
    Effect.runPromise(f.service.apply(preview.sourceRevision, preview.revision)),
  ).rejects.toThrow();
  expect(git(f.remote, "show", "main:race.txt")).toBe("concurrent");
});
