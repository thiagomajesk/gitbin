import { BinaryObjects } from "./blobs";
import { contentHash, type FileContent } from "./content";
import { ownerAt } from "./decisions";
import { FileDocument } from "./file";
import type { RemoteSnapshot } from "./ports";
import { validPath } from "./protocol";

function remotePaths(snapshot: RemoteSnapshot): Map<string, FileContent> {
  const paths = new Map<string, FileContent>();
  const blobs = new BinaryObjects();
  blobs.import(snapshot.blobs ?? new Map());
  for (const [id, update] of snapshot.states) {
    const incoming = new FileDocument(id, undefined, blobs);
    try {
      incoming.merge(update);
      const content = incoming.content;
      for (const [, location] of incoming.locations())
        if (location.path !== null) paths.set(location.path, content);
    } finally {
      incoming.destroy();
    }
  }
  return paths;
}

export function validateRemote(snapshot: RemoteSnapshot): void {
  if (snapshot.states.size === 0 && snapshot.files.size > 0)
    throw new Error(
      "This remote folder already contains untracked files. Choose a new empty repository folder for the first registration.",
    );
  const paths = remotePaths(snapshot);
  for (const [path, text] of snapshot.files)
    if (!paths.has(path) || contentHash(paths.get(path) as FileContent) !== contentHash(text))
      throw new Error(
        `File at ${path} differs from its CRDT state. External Git edits are not imported in this alpha.`,
      );
  for (const path of paths.keys())
    if (!snapshot.files.has(path))
      throw new Error(`Tracked remote file is missing: ${path}. Its CRDT state was not updated.`);
}

export function availablePath(path: string, id: string, owners: Set<string>): string {
  let candidate = path;
  let attempt = 0;
  let owner = ownerAt([...owners], candidate.toLowerCase());
  while (owner !== undefined) {
    const segments = path.split("/");
    const index = candidate.toLowerCase().startsWith(`${owner}/`)
      ? owner.split("/").length - 1
      : segments.length - 1;
    const segment = segments[index];
    if (segment === undefined) throw new Error("Invalid file path.");
    const suffix = ` (${id}${attempt++ ? `-${attempt}` : ""})`;
    segments[index] =
      index === segments.length - 1
        ? segment.replace(/(\.[^.]*)?$/, (extension) => suffix + extension)
        : segment + suffix;
    candidate = segments.join("/");
    if (!validPath(candidate)) throw new Error("Resolved file path is too long.");
    owner = ownerAt([...owners], candidate.toLowerCase());
  }
  return candidate;
}
