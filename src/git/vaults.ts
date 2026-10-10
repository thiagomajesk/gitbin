import { type Registration, validateVaults } from "../core/protocol";
export function discoverVaults(entries: ReadonlyMap<string, string>): ReadonlyArray<Registration> {
  const roots = new Set<string>();
  for (const path of entries.keys()) {
    if (!path.startsWith(".gitbin/")) continue;
    if (path === ".gitbin/metadata.json") continue;
    if (/^\.gitbin\/vaults\/[^/]+\/retained\/[a-f0-9]{40}$/.test(path)) continue;
    const match = /^\.gitbin\/vaults\/([^/]+)\/(?:notes|attachments)\/[a-f0-9-]{36}\.bin$/.exec(
      path,
    );
    if (!match?.[1]) throw new Error("Invalid Gitbin storage path.");
    roots.add(match[1]);
  }
  const vaults = Array.from(roots)
    .sort()
    .map((root) => ({ name: root, root }));
  validateVaults(vaults);
  return vaults;
}
