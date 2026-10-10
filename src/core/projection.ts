import { BinaryObjects } from "./blobs";
import { contentEqual, contentHash, type FileContent } from "./content";
import { FileDocument } from "./file";
import type { RemoteSnapshot } from "./ports";
import { validPath, type WriteIntent } from "./protocol";

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

function ownerAt(owners: Set<string>, path: string): string | undefined {
  const key = path.toLowerCase();
  return Array.from(owners).find(
    (existing) =>
      existing === key || existing.startsWith(`${key}/`) || key.startsWith(`${existing}/`),
  );
}

function selectedPath(file: FileDocument): string | null {
  const locations = [...file.locations()].sort(([left], [right]) =>
    left < right ? 1 : left > right ? -1 : 0,
  );
  if (locations.length === 0) throw new Error("Missing file location.");
  const live = locations.find(([, location]) => location.path !== null);
  const path =
    live?.[1].path ??
    (locations.some(([, location]) => file.deletionHasEdits(location))
      ? (file.previousPath() ?? `Recovered ${file.id}`)
      : null);
  if (locations.length > 1 || locations[0]?.[1].path !== path) file.move(path);
  return path;
}

function availablePath(path: string, file: FileDocument, owners: Set<string>): string {
  let candidate = path;
  let attempt = 0;
  let owner = ownerAt(owners, candidate);
  while (owner !== undefined) {
    const segments = path.split("/");
    const index = candidate.toLowerCase().startsWith(`${owner}/`)
      ? owner.split("/").length - 1
      : segments.length - 1;
    const segment = segments[index];
    if (segment === undefined) throw new Error("Invalid file path.");
    const suffix = ` (${file.id}${attempt++ ? `-${attempt}` : ""})`;
    segments[index] =
      index === segments.length - 1
        ? segment.replace(/(\.[^.]*)?$/, (extension) => suffix + extension)
        : segment + suffix;
    candidate = segments.join("/");
    if (!validPath(candidate)) throw new Error("Resolved file path is too long.");
    owner = ownerAt(owners, candidate);
  }
  return candidate;
}

export function projectFiles(states: Iterable<FileDocument>): { files: Map<string, FileContent> } {
  const files = new Map<string, FileContent>();
  const owners = new Set<string>();
  for (const file of Array.from(states).sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  )) {
    const path = selectedPath(file);
    if (path === null) continue;
    if (!validPath(path)) throw new Error("Unsafe file path in remote data.");
    const target = availablePath(path, file, owners);
    if (target !== path) file.move(target);
    owners.add(target.toLowerCase());
    files.set(target, file.content);
  }
  return { files };
}

export function checkUnchanged(
  states: Iterable<FileDocument>,
  files: ReadonlyMap<string, FileContent>,
): void {
  for (const file of states)
    if (
      file.baselinePath !== null &&
      !contentEqual(files.get(file.baselinePath), file.baselineContent)
    )
      throw new Error("A file changed during sync. Its edits were preserved; run Sync again.");
}

function plannedWrite(
  path: string,
  after: FileContent,
  before: FileContent | null,
  owner: FileDocument | undefined,
): WriteIntent | null {
  if (before !== null && !owner && !contentEqual(before, after))
    throw new Error(`A new local file appeared at ${path}. It was preserved; sync again.`);
  return contentEqual(before, after) ? null : { path, before, after };
}

export function planWrites(
  states: ReadonlyMap<string, FileDocument>,
  files: ReadonlyMap<string, FileContent>,
  local: ReadonlyMap<string, FileContent>,
): WriteIntent[] {
  const writes: WriteIntent[] = [];
  const owners = new Map(Array.from(states.values(), (file) => [file.baselinePath, file]));
  for (const [path, after] of files) {
    const write = plannedWrite(path, after, local.get(path) ?? null, owners.get(path));
    if (write) writes.push(write);
  }
  for (const file of states.values())
    if (file.baselinePath !== null && !files.has(file.baselinePath))
      writes.push({ path: file.baselinePath, before: file.baselineContent, after: null });
  const blocked = (write: WriteIntent) =>
    write.after !== null &&
    Array.from(local.keys()).some(
      (path) =>
        path !== write.path &&
        (path.toLowerCase() === write.path.toLowerCase() ||
          path.toLowerCase().startsWith(`${write.path.toLowerCase()}/`) ||
          write.path.toLowerCase().startsWith(`${path.toLowerCase()}/`)),
    );
  // Save relocated content before removing paths that block a new file or folder.
  return [
    ...writes.filter((write) => write.after !== null && !blocked(write)),
    ...writes.filter((write) => write.after === null),
    ...writes.filter(blocked),
  ];
}

export function captureExisting(file: FileDocument, files: ReadonlyMap<string, FileContent>): void {
  if (file.baselinePath === null) return;
  const text = files.get(file.baselinePath);
  if (text !== undefined) {
    if (!contentEqual(text, file.baselineContent)) file.captureContent(text);
    return;
  }
  const heads = file.locations();
  if (heads.length === 1 && heads[0]?.[1].path !== null)
    file.move(null, file.baselineContent ?? file.content);
  file.baselinePath = null;
  file.baselineContent = null;
}

export function attachFile(
  states: Map<string, FileDocument>,
  path: string,
  text: FileContent,
  blobs = new BinaryObjects(),
): void {
  if (!validPath(path)) throw new Error(`Unsupported local path: ${path}`);
  const matching = Array.from(states.values()).find((file) =>
    file.locations().some(([, location]) => location.path === path),
  );
  if (matching) {
    if (contentEqual(matching.content, text)) {
      matching.materialized(path);
      return;
    }
  }
  const file = new FileDocument(crypto.randomUUID(), undefined, blobs);
  file.edit(text);
  file.move(path);
  file.materialized(path);
  states.set(file.id, file);
}
