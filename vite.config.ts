import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import { homedir } from "node:os";
import { Schema } from "effect";
import tailwindcss from "@tailwindcss/vite";
import manifest from "./manifest.json" with { type: "json" };

function bundledPackage(id: string) {
  const normalized = id.replaceAll("\\", "/");
  const marker = normalized.lastIndexOf("/node_modules/");
  if (marker < 0) return null;
  const tail = normalized.slice(marker + 14).split("/");
  const name = tail[0]?.startsWith("@") ? tail.slice(0, 2).join("/") : tail[0];
  return name ? { name, root: normalized.slice(0, marker + 14) + name } : null;
}
function licenseText(name: string, root: string): string {
  if (name === "lru_map") {
    const readme = readFileSync(`${root}/README.md`, "utf8");
    return readme.slice(readme.indexOf("# MIT license") + "# MIT license".length).trim();
  }
  const candidates = [
    "LICENSE",
    "LICENSE.md",
    "LICENSE.txt",
    "LICENSE-MIT",
    "license",
    "license.md",
    "license.txt",
    "COPYING",
  ];
  const filename = candidates.find((file) => existsSync(`${root}/${file}`));
  if (!filename) throw new Error(`Missing bundled license for ${name}`);
  return readFileSync(`${root}/${filename}`, "utf8");
}
function bundledNotices(ids: Iterable<string>): string {
  const packages = new Map<string, string>();
  for (const id of ids) {
    const pkg = bundledPackage(id);
    if (pkg) packages.set(pkg.name, pkg.root);
  }
  return Array.from(packages)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, root]) => `${name}\n${"=".repeat(name.length)}\n${licenseText(name, root)}`)
    .join("\n\n");
}

const VaultRegistry = Schema.Struct({
  vaults: Schema.Record(
    Schema.String,
    Schema.Struct({
      path: Schema.String,
      ts: Schema.Number,
      open: Schema.optionalKey(Schema.Boolean),
    }),
  ),
});
function obsidianDirectory(): string {
  const home = homedir();
  const locations: Record<string, string> = {
    win32: process.env.APPDATA ?? resolve(home, "AppData/Roaming"),
    darwin: resolve(home, "Library/Application Support"),
    linux: process.env.XDG_CONFIG_HOME ?? resolve(home, ".config"),
  };
  const directory = locations[process.platform];
  if (!directory) throw new Error("Unsupported Obsidian development platform.");
  return directory;
}
function developmentVault(): string {
  const directory = obsidianDirectory();
  const registry = Schema.decodeUnknownSync(VaultRegistry)(
    JSON.parse(readFileSync(resolve(directory, "obsidian/obsidian.json"), "utf8")),
  );
  const vault = Object.values(registry.vaults)
    .filter((entry) => entry.open)
    .sort((left, right) => right.ts - left.ts)[0];
  if (!vault) throw new Error("Open your development vault in Obsidian, then run pnpm dev.");
  return vault.path;
}

function deployDevelopmentBundle(vault: string): void {
  if (!existsSync(resolve(vault, ".obsidian")))
    throw new Error("The open vault must use the standard .obsidian configuration folder.");
  const destination = resolve(vault, ".obsidian/plugins/gitbin");
  mkdirSync(destination, { recursive: true });
  for (const filename of [
    "main.js",
    "styles.css",
    "manifest.json",
    "LICENSE",
    "THIRD_PARTY_NOTICES.txt",
  ])
    copyFileSync(resolve("dist/gitbin", filename), resolve(destination, filename));
  writeFileSync(resolve(destination, ".hotreload"), "");
  console.info("gitbin: deployed development build to " + destination);
}

export default defineConfig(({ command, mode }) => ({
  resolve: {
    alias: [{ find: /^shiki$/, replacement: resolve("src/ui/diff-highlighter.ts") }],
  },
  define: command === "build" ? { "process.env.NODE_ENV": JSON.stringify("production") } : {},
  plugins: [
    ...(command === "build" ? [tailwindcss()] : []),
    {
      name: "gitbin-manifest",
      writeBundle() {
        if (mode !== "development") return;
        deployDevelopmentBundle(developmentVault());
      },
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "LICENSE",
          source: readFileSync("LICENSE", "utf8"),
        });
        this.emitFile({
          type: "asset",
          fileName: "THIRD_PARTY_NOTICES.txt",
          source: bundledNotices(this.getModuleIds()),
        });
        this.emitFile({
          type: "asset",
          fileName: "manifest.json",
          source: JSON.stringify(manifest, null, 2),
        });
      },
    },
  ],
  build: {
    outDir: "dist/gitbin",
    target: "es2022",
    lib: {
      entry: resolve(import.meta.dirname, "src/main.ts"),
      formats: ["cjs"],
      fileName: () => "main.js",
      cssFileName: "styles",
    },
    rolldownOptions: {
      external: ["obsidian", "node:os"],
      output: { exports: "default", inlineDynamicImports: true, dynamicImportInCjs: false },
    },
  },
  test: {
    alias: { obsidian: resolve("tests/obsidian.ts") },
    include: ["tests/**/*.test.{ts,tsx}"],
    testTimeout: 30000,
    fileParallelism: false,
  },
}));
