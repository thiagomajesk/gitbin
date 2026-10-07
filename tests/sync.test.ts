import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSyncEngine, type SyncEngine } from "../src/core/engine";
import { io, SyncError } from "../src/core/errors";
import type { GitRemote } from "../src/core/ports";
import type { Registration } from "../src/core/protocol";
import { createGitRemote, checkRemote } from "../src/git/remote";
import { MemoryFileSystem } from "just-git";
import { gitServer } from "./git-server";
import { MemoryVault } from "./helpers";
import { commitAuthor } from "../src/platform/device";
import {
  binaryContent,
  contentBytes,
  contentFromBytes,
  type FileContent,
} from "../src/core/content";

const execute = promisify(execFile);
vi.mock("obsidian", () => ({ Platform: {} }));
async function git(cwd: string, args: string[]): Promise<string> {
  return (await execute("git", args, { cwd })).stdout;
}

const run = Effect.runPromise;
let directory: string;
let remotePath: string;
let registration: Registration;
const engines: SyncEngine[] = [];
let server: Awaited<ReturnType<typeof gitServer>>;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "gitbin-test-"));
  remotePath = join(directory, "remote.git");
  await git(directory, ["init", "--bare", "--initial-branch=main", remotePath]);
  await git(remotePath, ["config", "http.receivepack", "true"]);
  server = await gitServer(directory);
  registration = { name: "Personal", root: "personal" };
});
afterEach(async () => {
  for (const engine of engines) engine.close();
  engines.length = 0;
  await server.close();
});

async function client(
  local = new MemoryVault(),
  vault = registration,
  wrapper?: (remote: GitRemote) => GitRemote,
  commitEmail = "",
) {
  const fs = new MemoryFileSystem();
  const fault = { failPush: false };
  const remote = createGitRemote({
    fs,
    url: server.url,
    network: {
      fetch: async (input, init) => {
        if (fault.failPush && String(input).endsWith("/git-receive-pack"))
          throw new Error("Simulated upload failure");
        return fetch(input, init);
      },
    },
    credentials: () => null,
    identity: {
      author: commitAuthor({ username: "alice", commitEmail }, "Laptop"),
      device: "Laptop",
    },
  });
  const engine = createSyncEngine(vault, local, wrapper ? wrapper(remote) : remote);
  engines.push(engine);
  await run(engine.open());
  return { engine, local, remote, fs, fault };
}

describe("single-main sync through real local Git", () => {
  it.each(["Attachments/Image.png", "Attachments/Document.pdf", "Diagram.canvas", "Table.base"])(
    "syncs %s byte-exactly without storing binary history payloads",
    async (path) => {
      const left = await client();
      const bytes = new Uint8Array([0, 0xff, 0x80, 1, 2, 3]);
      const content = contentFromBytes(path, bytes);
      left.local.files.set(path, content);
      await run(left.engine.sync());
      const right = await client();
      await run(right.engine.sync());
      expect(right.local.files.get(path)).toEqual(content);
      const blob = await execute("git", ["show", `main:personal/${path}`], {
        cwd: remotePath,
        encoding: "buffer",
      });
      expect(new Uint8Array(blob.stdout)).toEqual(bytes);
      expect(right.engine.history()[0]?.changes[0]?.result).toMatchObject({
        binary: true,
        text: null,
      });
    },
  );

  it("converges concurrent binary replacements after an offline journal reload without extra files", async () => {
    const left = await client();
    left.local.files.set("Image.png", binaryContent(new Uint8Array([0, 1])));
    await run(left.engine.sync());
    const right = await client();
    await run(right.engine.sync());
    const a = binaryContent(new Uint8Array([0, 2]));
    const b = binaryContent(new Uint8Array([0, 3]));
    left.local.files.set("Image.png", a);
    right.local.files.set("Image.png", b);
    await run(left.engine.capture());
    await run(right.engine.capture());
    left.engine.close();
    const restarted = await client(left.local);
    await run(right.engine.sync());
    await run(restarted.engine.sync());
    await run(right.engine.sync());
    expect(right.local.files).toEqual(restarted.local.files);
    expect(right.local.files.size).toBe(1);
    expect([a, b]).toContainEqual(right.local.files.get("Image.png"));
    const blob = await execute("git", ["show", "main:personal/Image.png"], {
      cwd: remotePath,
      encoding: "buffer",
    });
    expect(new Uint8Array(blob.stdout)).toEqual(
      contentBytes(right.local.files.get("Image.png") as FileContent),
    );
  });

  it("combines a binary rename with a concurrent replacement", async () => {
    const left = await client();
    const original = binaryContent(new Uint8Array([0, 1]));
    const edited = binaryContent(new Uint8Array([0, 2]));
    left.local.files.set("Image.png", original);
    await run(left.engine.sync());
    const right = await client();
    await run(right.engine.sync());
    left.local.files.delete("Image.png");
    left.local.files.set("Attachments/Image.png", original);
    await run(left.engine.rename("Image.png", "Attachments/Image.png"));
    right.local.files.set("Image.png", edited);
    await run(left.engine.sync());
    await run(right.engine.sync());
    await run(left.engine.sync());
    expect(right.local.files).toEqual(left.local.files);
    expect(right.local.files.size).toBe(1);
    expect(right.local.files.get("Attachments/Image.png")).toEqual(edited);
  });

  it("retains a binary replacement made concurrently with deletion", async () => {
    const left = await client();
    left.local.files.set("Image.png", binaryContent(new Uint8Array([0, 1])));
    await run(left.engine.sync());
    const right = await client();
    await run(right.engine.sync());
    left.local.files.delete("Image.png");
    const edited = binaryContent(new Uint8Array([0, 2]));
    right.local.files.set("Image.png", edited);
    await run(left.engine.sync());
    await run(right.engine.sync());
    await run(left.engine.sync());
    expect(left.local.files).toEqual(right.local.files);
    expect(left.local.files.get("Image.png")).toEqual(edited);
  });

  it("leaves a new empty vault unpublished until its first file exists", async () => {
    const local = await client();
    const publish = vi.spyOn(local.remote, "publish");
    expect(await run(local.engine.sync())).toMatchObject({ published: true, revision: null });
    expect(await run(local.engine.sync())).toMatchObject({ published: true, revision: null });
    expect(publish).not.toHaveBeenCalled();
    expect((await git(remotePath, ["for-each-ref", "--format=%(refname)"])).trim()).toBe("");
    local.local.files.set("First.md", "First content");
    await run(local.engine.sync());
    expect(publish).toHaveBeenCalledOnce();
    expect(await git(remotePath, ["show", "main:personal/First.md"])).toBe("First content");
    const paths = await git(remotePath, ["ls-tree", "-r", "--name-only", "main"]);
    expect(paths).not.toContain(".keep");
    expect(paths).toMatch(/\.gitbin\/vaults\/personal\/[a-f0-9-]{36}\.bin/);
  });

  it("does not register an empty vault in an already populated repository", async () => {
    const personal = await client();
    personal.local.files.set("Existing.md", "Existing content");
    const existing = await run(personal.engine.sync());
    const work = await client(new MemoryVault(), { name: "Work", root: "work" });
    const publish = vi.spyOn(work.remote, "publish");
    expect(await run(work.engine.sync())).toMatchObject({
      published: true,
      revision: existing.revision,
    });
    expect(publish).not.toHaveBeenCalled();
    expect((await git(remotePath, ["rev-parse", "main"])).trim()).toBe(existing.revision);
    expect(await git(remotePath, ["ls-tree", "-r", "--name-only", "main"])).not.toContain("work/");
  });

  it("publishes deletion of the last file and retains its CRDT state", async () => {
    const left = await client();
    left.local.files.set("Last.md", "Content");
    const initial = await run(left.engine.sync());
    const right = await client();
    await run(right.engine.sync());
    left.local.files.delete("Last.md");
    const deleted = await run(left.engine.sync());
    expect(deleted.revision).not.toBe(initial.revision);
    await run(right.engine.sync());
    expect(right.local.files.size).toBe(0);
    const paths = await git(remotePath, ["ls-tree", "-r", "--name-only", "main"]);
    expect(paths).not.toContain("personal/Last.md");
    expect(paths).not.toContain(".keep");
    expect(paths.trim().split("\n")).toHaveLength(1);
    expect(paths).toMatch(/\.gitbin\/vaults\/personal\/[a-f0-9-]{36}\.bin/);
    expect((await run(left.remote.read(registration))).vaults).toEqual([
      { name: "personal", root: "personal" },
    ]);
  });

  it.each(["", "alice@example.com"])(
    "records author email %s and Gitbin on this device as committer",
    async (commitEmail) => {
      const local = await client(undefined, undefined, undefined, commitEmail);
      local.local.files.set("Example.md", "An authored note.");
      await run(local.engine.sync());
      expect(await git(remotePath, ["log", "-1", "--format=%an%n%ae%n%cn%n%ce%n%s"])).toBe(
        `alice\n${commitEmail || "alice@Laptop"}\nGitbin\ngitbin@Laptop\ngitbin: sync \`Personal\` from \`Laptop\`\n`,
      );
    },
  );
  it("keeps saved edits and the journal on a diff timeout, then syncs after reopening", async () => {
    const left = await client();
    left.local.files.set("Unicode.md", "Original 😀");
    await run(left.engine.sync());
    const journal = structuredClone(left.local.journal);
    const revision = await git(remotePath, ["rev-parse", "main"]);
    left.local.files.set("Unicode.md", "Updated 😃");
    let timestamp = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => (timestamp += 101));
    try {
      await expect(run(left.engine.capture())).rejects.toThrow("Could not capture");
      expect(left.local.journal).toEqual(journal);
      expect(left.local.files.get("Unicode.md")).toBe("Updated 😃");
    } finally {
      clock.mockRestore();
    }
    expect(await git(remotePath, ["rev-parse", "main"])).toBe(revision);
    const reopened = await client(left.local);
    await run(reopened.engine.sync());
    expect(await git(remotePath, ["show", "main:personal/Unicode.md"])).toBe("Updated 😃");
    expect(left.local.journal?.files[0]?.baselineContent?.value).toBe("Updated 😃");
  });

  it("detects changes to this vault without traversing Git history", async () => {
    const personal = await client();
    personal.local.files.set("One.md", "Original");
    const first = await run(personal.engine.sync());
    const work = await client(new MemoryVault(), {
      name: "Work",
      root: "work",
    });
    work.local.files.set("Two.md", "Other vault");
    const other = await run(work.engine.sync());
    const current = await run(personal.remote.inspect(registration, first.revision));
    expect(current.find((row) => row.connected)).toMatchObject({
      latest: other.revision,
      applied: first.revision,
      changed: false,
    });
    const phone = await client();
    await run(phone.engine.sync());
    phone.local.files.set("One.md", "Changed remotely");
    const newer = await run(phone.engine.sync());
    const outdated = await run(personal.remote.inspect(registration, first.revision));
    expect(outdated.find((row) => row.connected)).toMatchObject({
      latest: newer.revision,
      applied: first.revision,
      changed: true,
    });
    expect(outdated.find((row) => !row.connected)).toMatchObject({ changed: null, applied: null });
  });
  it("bootstraps, downloads, and merges two offline clients", async () => {
    const laptop = await client();
    laptop.local.files.set("List.md", "Buy milk\n");
    await run(laptop.engine.sync());
    const phone = await client();
    await run(phone.engine.sync());
    expect(phone.local.files.get("List.md")).toBe("Buy milk\n");
    laptop.local.files.set("List.md", "Buy milk and bread\n");
    phone.local.files.set("List.md", "Buy oat milk\n");
    await run(laptop.engine.sync());
    await run(phone.engine.sync());
    await run(laptop.engine.sync());
    expect(laptop.local.files.get("List.md")).toBe("Buy oat milk and bread\n");
    expect(phone.local.files).toEqual(laptop.local.files);
    const entry = phone.engine.history()[0];
    expect(entry?.baselineKnown).toBe(true);
    expect(entry?.changes[0]).toMatchObject({
      kind: "combined",
      baseline: { text: "Buy milk\n" },
      local: { text: "Buy oat milk\n" },
      incoming: { text: "Buy milk and bread\n" },
      result: { text: "Buy oat milk and bread\n" },
    });
    const reopened = await client(phone.local);
    expect(reopened.engine.history()).toEqual(phone.engine.history());
    await run(reopened.engine.sync());
    expect(reopened.engine.history()).toEqual(phone.engine.history());
    const refs = await git(remotePath, ["for-each-ref", "--format=%(refname)"]);
    expect(refs.trim()).toBe("refs/heads/main");
    expect(await git(remotePath, ["log", "--format=%P"])).not.toMatch(/[a-f0-9]{40} [a-f0-9]{40}/);
  });

  it("preserves a second vault while updating the first", async () => {
    const personal = await client();
    personal.local.files.set("One.md", "Personal");
    await run(personal.engine.sync());
    const work = await client(new MemoryVault(), {
      name: "Work",
      root: "work",
    });
    work.local.files.set("Two.md", "Work");
    await run(work.engine.sync());
    personal.local.files.set("One.md", "Personal changed");
    await run(personal.engine.sync());
    await run(work.engine.sync());
    expect(work.local.files.get("Two.md")).toBe("Work");
    const paths = await git(remotePath, ["ls-tree", "-r", "--name-only", "main"]);
    expect(paths).not.toContain("repository.json");
    expect(paths).not.toContain(".gitbin/version");
    expect(paths).not.toContain(".keep");
    expect(paths).toMatch(/\.gitbin\/vaults\/work\/[a-f0-9-]{36}\.bin/);
    expect(paths).toMatch(/\.gitbin\/vaults\/personal\/[a-f0-9-]{36}\.bin/);
    expect(await git(remotePath, ["ls-tree", "-r", "--name-only", "main"])).not.toContain(
      "personal/.gitbin",
    );
  });

  it("retries a competing push by constructing a new commit on latest main", async () => {
    const seed = await client();
    seed.local.files.set("List.md", "Buy milk\n");
    await run(seed.engine.sync());
    const competitor = await client();
    await run(competitor.engine.sync());
    let race = false;
    const racing = await client(new MemoryVault(), registration, (remote) => ({
      read: (vault) => remote.read(vault),
      publish: (base, publication) =>
        Effect.gen(function* () {
          if (race) {
            race = false;
            yield* competitor.engine.sync();
          }
          return yield* remote.publish(base, publication);
        }),
    }));
    await run(racing.engine.sync());
    competitor.local.files.set("List.md", "Buy oat milk\n");
    racing.local.files.set("List.md", "Buy milk and bread\n");
    race = true;
    await run(racing.engine.sync());
    await run(competitor.engine.sync());
    expect(racing.local.files.get("List.md")).toBe("Buy oat milk and bread\n");
    expect(competitor.local.files).toEqual(racing.local.files);
  });

  it("restores CRDT identity and unpublished offline edits from the journal", async () => {
    const first = await client();
    first.local.files.set("List.md", "Buy milk\n");
    await run(first.engine.sync());
    first.local.files.set("List.md", "Buy milk and bread\n");
    await run(first.engine.capture());
    const second = await client();
    await run(second.engine.sync());
    second.local.files.set("List.md", "Buy oat milk\n");
    await run(second.engine.sync());
    first.engine.close();
    const restarted = await client(first.local);
    await run(restarted.engine.sync());
    expect(restarted.local.files.get("List.md")).toBe("Buy oat milk and bread\n");
  });

  it("merges a tracked rename with another device's edit", async () => {
    const left = await client();
    left.local.files.set("Old.md", "Start");
    await run(left.engine.sync());
    const right = await client();
    await run(right.engine.sync());
    left.local.files.delete("Old.md");
    left.local.files.set("New.md", "Start");
    await run(left.engine.rename("Old.md", "New.md"));
    right.local.files.set("Old.md", "Start with edit");
    await run(left.engine.sync());
    await run(right.engine.sync());
    expect(right.local.files.get("New.md")).toBe("Start with edit");
    expect(right.local.files.has("Old.md")).toBe(false);
  });

  it("automatically retains edits made concurrently with deletion", async () => {
    const left = await client();
    left.local.files.set("A.md", "Start");
    await run(left.engine.sync());
    const right = await client();
    await run(right.engine.sync());
    left.local.files.delete("A.md");
    right.local.files.set("A.md", "Start with edit");
    await run(left.engine.sync());
    const result = await run(right.engine.sync());
    expect(result.published).toBe(true);
    expect(right.local.files.get("A.md")).toBe("Start with edit");
    await run(left.engine.sync());
    expect(left.local.files).toEqual(right.local.files);
  });

  it("automatically gives colliding files distinct paths without losing either", async () => {
    const left = await client();
    await run(left.engine.sync());
    const right = await client();
    await run(right.engine.sync());
    left.local.files.set("A.md", "Left");
    right.local.files.set("A.md", "Right");
    await run(left.engine.capture());
    await run(right.engine.capture());
    await run(left.engine.sync());
    const result = await run(right.engine.sync());
    expect(result.published).toBe(true);
    expect(new Set(right.local.files.values())).toEqual(new Set(["Left", "Right"]));
    await run(left.engine.sync());
    expect(left.local.files).toEqual(right.local.files);
  });

  it("resumes an interrupted materialization after restart", async () => {
    const left = await client();
    left.local.files.set("A.md", "A");
    left.local.files.set("B.md", "B");
    await run(left.engine.sync());
    const broken = new MemoryVault();
    broken.failAfter = 1;
    const right = await client(broken);
    await expect(run(right.engine.sync())).rejects.toThrow();
    expect(broken.journal?.intents).toHaveLength(2);
    broken.failAfter = null;
    const restarted = await client(broken);
    await run(restarted.engine.sync());
    expect(broken.files).toEqual(left.local.files);
    expect(broken.journal?.intents).toEqual([]);
  });

  it("stops if a local file changes while remote data is fetched", async () => {
    const left = await client();
    left.local.files.set("A.md", "Start");
    await run(left.engine.sync());
    let interrupt = false;
    const local = new MemoryVault();
    const right = await client(local, registration, (remote) => ({
      read: (vault) =>
        remote.read(vault).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              if (interrupt) local.files.set("A.md", "New local edit");
            }),
          ),
        ),
      publish: (base, publication) => remote.publish(base, publication),
    }));
    await run(right.engine.sync());
    interrupt = true;
    await expect(run(right.engine.sync())).rejects.toThrow();
    expect(local.files.get("A.md")).toBe("New local edit");
    interrupt = false;
    await run(right.engine.sync());
    expect(local.files.get("A.md")).toBe("New local edit");
  });

  it("refuses overlapping vault roots", async () => {
    const left = await client();
    await run(left.engine.sync());
    const right = await client(new MemoryVault(), {
      name: "Nested",
      root: "personal/nested",
    });
    await expect(run(right.engine.sync())).rejects.toThrow();
  });

  it("retains both local and remote files when connecting a populated vault", async () => {
    const left = await client();
    left.local.files.set("A.md", "Remote");
    await run(left.engine.sync());
    const local = new MemoryVault();
    local.files.set("A.md", "Different local");
    const right = await client(local);
    await run(right.engine.sync());
    expect(new Set(local.files.values())).toEqual(new Set(["Remote", "Different local"]));
  });

  it("refuses external Markdown edits that disagree with CRDT state", async () => {
    const left = await client();
    left.local.files.set("A.md", "Start");
    await run(left.engine.sync());
    const writer = join(directory, "external");
    await git(directory, ["clone", remotePath, writer]);
    await git(writer, ["config", "user.name", "Test"]);
    await git(writer, ["config", "user.email", "test@localhost"]);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(writer, "personal/A.md"), "External");
    await git(writer, ["add", "."]);
    await git(writer, ["commit", "-m", "External edit"]);
    await git(writer, ["push"]);
    await expect(run(left.engine.sync())).rejects.toThrow();
    expect(left.local.files.get("A.md")).toBe("Start");
    expect(await readFile(join(writer, "personal/A.md"), "utf8")).toBe("External");
  });

  it("keeps note identity when an entire folder is renamed", async () => {
    const left = await client();
    left.local.files.set("Old/A.md", "Start");
    await run(left.engine.sync());
    const right = await client();
    await run(right.engine.sync());
    left.local.files.delete("Old/A.md");
    left.local.files.set("New/A.md", "Start");
    await run(left.engine.rename("Old", "New"));
    right.local.files.set("Old/A.md", "Start with edit");
    await run(left.engine.sync());
    await run(right.engine.sync());
    expect(right.local.files.get("New/A.md")).toBe("Start with edit");
    expect(right.local.files.has("Old/A.md")).toBe(false);
  });

  it("ignores interrupted untracked files in its private Git cache", async () => {
    const left = await client();
    left.local.files.set("A.md", "Start");
    await run(left.engine.sync());
    await left.fs.mkdir("/repo/personal", { recursive: true });
    await left.fs.writeFile("/repo/personal/Leftover.md", "Do not publish");
    const snapshot = await run(left.remote.read(registration));
    expect(snapshot.files.has("Leftover.md")).toBe(false);
    left.local.files.set("A.md", "Changed");
    await run(left.engine.sync());
    expect(await git(remotePath, ["ls-tree", "-r", "--name-only", "main"])).not.toContain(
      "Leftover.md",
    );
  });

  it("automatically relocates file-versus-folder path collisions", async () => {
    const left = await client();
    await run(left.engine.sync());
    const right = await client();
    await run(right.engine.sync());
    left.local.files.set("A.md", "File");
    right.local.files.set("A.md/B.md", "Nested");
    await run(left.engine.capture());
    await run(right.engine.capture());
    await run(left.engine.sync());
    const result = await run(right.engine.sync());
    expect(result.published).toBe(true);
    expect(new Set(right.local.files.values())).toEqual(new Set(["File", "Nested"]));
    await run(left.engine.sync());
    expect(left.local.files).toEqual(right.local.files);
  });

  it("publishes an unchanged cached commit after an initial push failure", async () => {
    // An invalid receive program rejects writes while fetch/ls-remote still work.
    const left = await client();
    left.local.files.set("A.md", "Pending first push");
    await run(left.remote.read(registration));
    left.fault.failPush = true;
    await expect(run(left.engine.sync())).rejects.toThrow();
    expect(left.engine.history()).toEqual([]);
    expect((await git(remotePath, ["for-each-ref", "--format=%(refname)"])).trim()).toBe("");
    left.fault.failPush = false;
    const result = await run(left.engine.sync());
    expect(result.published).toBe(true);
    expect(await git(remotePath, ["show", "main:personal/A.md"])).toBe("Pending first push");
  });

  it("acknowledges a successful sync when local history storage fails", async () => {
    const left = await client();
    left.local.files.set("A.md", "Content still syncs");
    vi.spyOn(left.local, "saveHistory").mockReturnValueOnce(
      Effect.fail(new SyncError({ message: "Disk full" })),
    );
    const result = await run(left.engine.sync());
    expect(result.published).toBe(true);
    expect(result.historyWarning).toContain("history could not be saved");
    expect(await git(remotePath, ["show", "main:personal/A.md"])).toBe("Content still syncs");
    expect(left.local.history).toBeNull();
    expect((await run(left.engine.sync())).historyWarning).toBeNull();
    expect(left.local.history?.entries).toHaveLength(1);
  });

  it("uses a typed failure for offline transport while preserving the journal", async () => {
    const left = await client();
    left.local.files.set("A.md", "Start");
    await run(left.engine.sync());
    left.local.files.set("A.md", "Offline edit");
    await run(left.engine.capture());
    const offline: GitRemote = {
      read: () =>
        io("Offline", async () => {
          throw new Error("No network");
        }),
      publish: () => Effect.succeed({ published: false, revision: null }),
    };
    const engine = createSyncEngine(registration, left.local, offline);
    engines.push(engine);
    await run(engine.open());
    await expect(run(engine.sync())).rejects.toThrow();
    expect(left.local.journal?.files[0]?.baselineContent?.value).toBe("Offline edit");
  });
});

describe("remote URL validation", () => {
  it("accepts credential-free HTTPS remotes from major providers", () => {
    for (const url of ["https://github.com/user/repo.git", "https://gitlab.com/user/repo.git"])
      expect(() => checkRemote(url)).not.toThrow();
  });
  it("rejects embedded tokens and command-like remotes", () => {
    for (const url of [
      "https://token@github.com/user/repo.git",
      "-oProxyCommand=bad",
      "ext::bad",
      "git@github.com:user/repo.git",
      "ssh://git@gitlab.com/user/repo.git",
      "https://github.com/a\nb",
    ])
      expect(() => checkRemote(url)).toThrow();
  });
});
