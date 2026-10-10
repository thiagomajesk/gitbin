import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  checkToolchain,
  lemmaDirectory,
  mustRun,
  toolchain,
  toolsDirectory,
} from "./proof-tools.mjs";

async function download(url, destination, expected) {
  if (cachedDownload(destination, expected)) return;
  const response = await fetch(url);
  if (!response.ok) throw new Error("Download failed: " + response.status + " " + url);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (digest(bytes) !== expected) throw new Error("Checksum mismatch: " + url);
  writeFileSync(destination, bytes);
}
function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
async function setup() {
  const asset = toolchain.dafny.assets[process.platform + "-" + process.arch];
  if (!asset) throw new Error("No pinned Dafny archive for this platform.");
  const packageManager = process.env.npm_execpath;
  if (!packageManager) throw new Error("Run this installer with pnpm proof:setup.");
  mkdirSync(toolsDirectory, { recursive: true });
  const source = resolve(toolsDirectory, "lemmascript.tar.gz");
  await download(
    "https://github.com/midspiral/LemmaScript/archive/" + toolchain.lemma.revision + ".tar.gz",
    source,
    toolchain.lemma.sha256,
  );
  mustRun("tar", ["-xzf", source, "-C", toolsDirectory]);
  const pnpm = (args) =>
    mustRun(process.execPath, [packageManager, "--dir", lemmaDirectory, ...args]);
  pnpm(["import"]);
  pnpm(["install", "--frozen-lockfile", "--ignore-scripts"]);
  pnpm(["run", "build"]);
  const archive = resolve(toolsDirectory, "dafny.zip");
  await download(
    "https://github.com/dafny-lang/dafny/releases/download/v" +
      toolchain.dafny.version +
      "/" +
      asset.file,
    archive,
    asset.sha256,
  );
  if (process.platform === "win32") mustRun("tar", ["-xf", archive, "-C", toolsDirectory]);
  else mustRun("unzip", ["-o", "-q", archive, "-d", toolsDirectory]);
  writeFileSync(resolve(toolsDirectory, "proof-toolchain.json"), JSON.stringify(toolchain));
  checkToolchain();
  console.log("Installed pinned LemmaScript source and Dafny " + toolchain.dafny.version);
}
await setup();

function cachedDownload(destination, expected) {
  return existsSync(destination) && digest(readFileSync(destination)) === expected;
}
