import type { InventoryFile, LocationOperation } from "./inventory";
import { validPath } from "./protocol";

function locationGraph(operations: readonly LocationOperation[]) {
  if (!operations.length) throw new Error("Missing file location.");
  const records = new Map(operations.map((operation) => [operation.id, operation]));
  if (records.size !== operations.length) throw new Error("Duplicate location identity.");
  const pending = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const operation of operations) {
    validateOperation(operation);
    pending.set(operation.id, operation.parents.length);
    for (const parent of operation.parents) {
      if (!records.has(parent)) throw new Error("Missing location parent.");
      const descendants = children.get(parent) ?? [];
      descendants.push(operation.id);
      children.set(parent, descendants);
    }
  }
  return { pending, children };
}
function validateOperation(operation: LocationOperation): void {
  if (
    !/^[a-f0-9-]{36}$/.test(operation.id) ||
    (operation.path !== null && !validPath(operation.path))
  )
    throw new Error("Invalid location operation.");
  if (new Set(operation.parents).size !== operation.parents.length)
    throw new Error("Duplicate location parent.");
}
export function validateLocations(operations: readonly LocationOperation[]): void {
  const { pending, children } = locationGraph(operations);
  const ready = operations
    .filter((operation) => operation.parents.length === 0)
    .map((operation) => operation.id);
  for (let index = 0; index < ready.length; index++) {
    for (const child of children.get(ready[index] ?? "") ?? []) {
      const count = (pending.get(child) ?? 0) - 1;
      pending.set(child, count);
      if (count === 0) ready.push(child);
    }
  }
  if (ready.length !== operations.length) throw new Error("Cyclic location history.");
}

function locationHeads(operations: readonly LocationOperation[]): readonly LocationOperation[] {
  const parents = new Set(operations.flatMap((operation) => operation.parents));
  return operations.filter((operation) => !parents.has(operation.id));
}

export function moveRecord(
  file: InventoryFile,
  path: string | null,
  observedHash = file.content.hash,
): InventoryFile {
  if (path !== null && !validPath(path)) throw new Error("Unsupported file path.");
  const operation = {
    id: crypto.randomUUID(),
    path,
    parents: locationHeads(file.locations).map((head) => head.id),
    contentHash: observedHash,
  };
  return { ...file, path, locations: [...file.locations, operation] };
}

export function mergeLocations(
  left: InventoryFile,
  right: InventoryFile,
): readonly LocationOperation[] {
  const records = new Map<string, LocationOperation>();
  for (const operation of [...left.locations, ...right.locations]) {
    const previous = records.get(operation.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(operation))
      throw new Error("Conflicting location operation identity.");
    records.set(operation.id, operation);
  }
  return [...records.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function resolvedLocation(file: InventoryFile): string | null {
  const heads = [...locationHeads(file.locations)].sort((a, b) => b.id.localeCompare(a.id));
  if (!heads.length) throw new Error("Missing file location.");
  const live = heads.find((head) => head.path !== null);
  if (live) return live.path;
  if (heads.every((head) => head.contentHash === file.content.hash)) return null;
  return (
    [...file.locations].reverse().find((operation) => operation.path !== null)?.path ??
    `Recovered ${file.id}`
  );
}

export function reconcileLocations(file: InventoryFile): InventoryFile {
  const path = resolvedLocation(file);
  return locationHeads(file.locations).length === 1 && file.path === path
    ? file
    : moveRecord(file, path);
}
