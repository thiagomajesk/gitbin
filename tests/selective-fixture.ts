import { Effect } from "effect";
import type { AvailabilityJournal } from "../src/core/availability";
import { attempt } from "../src/core/errors";
import { type ObjectReference, objectReference, verifyObject } from "../src/core/inventory";
import { createSelectiveEngine } from "../src/core/selective-engine";
import type {
  DeviceLimits,
  InventorySnapshot,
  SelectiveRemote,
  SelectiveVault,
} from "../src/core/selective-ports";

export const encoded = (text: string) => new TextEncoder().encode(text);
export const decoded = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes);
export const selectiveLimits: DeviceLimits = {
  downloadBytes: 65536,
  storageBytes: 10485760,
  mode: "on-demand",
};
export class SelectiveDevice implements SelectiveVault {
  readonly files = new Map<string, Uint8Array>();
  readonly cache = new Map<string, Uint8Array>();
  readonly opened = new Set<string>();
  journal: AvailabilityJournal | null = null;
  failAfterWrite = false;
  list = () =>
    Effect.succeed(
      new Map([...this.files].map(([path, bytes]) => [path, { bytes: bytes.length, modified: 0 }])),
    );
  read = (path: string, limit: number) =>
    attempt("Cannot read fixture file.", () => {
      const bytes = this.files.get(path);
      if (bytes && bytes.length > limit) throw new Error("Limit exceeded.");
      return bytes?.slice() ?? null;
    });
  write = (
    path: string,
    before: ObjectReference | null,
    after: Uint8Array | null,
    unload = false,
  ) =>
    attempt("Cannot write fixture file.", () => {
      const current = this.files.get(path);
      if (unload && this.opened.has(path)) throw new Error("File is open.");
      if ((current ? objectReference(current).hash : null) !== (before?.hash ?? null))
        throw new Error("Concurrent edit.");
      if (after) this.files.set(path, after.slice());
      else this.files.delete(path);
      if (this.failAfterWrite) {
        this.failAfterWrite = false;
        throw new Error("Interrupted after write.");
      }
    });
  load = () => Effect.succeed(this.journal);
  save = (journal: AvailabilityJournal) =>
    Effect.sync(() => {
      this.journal = structuredClone(journal);
    });
  put = (bytes: Uint8Array) =>
    Effect.sync(() => {
      const reference = objectReference(bytes);
      this.cache.set(reference.hash, bytes.slice());
      return reference;
    });
  object = (reference: ObjectReference, limit: number) =>
    attempt("Cannot read fixture object.", () => {
      if (reference.bytes > limit) throw new Error("Limit exceeded.");
      const bytes = this.cache.get(reference.hash);
      if (bytes) verifyObject(bytes, reference);
      return bytes?.slice() ?? null;
    });
  hasObject = (reference: ObjectReference) =>
    Effect.succeed(this.cache.get(reference.hash)?.length === reference.bytes);
  objects = () =>
    Effect.succeed(new Map([...this.cache].map(([hash, bytes]) => [hash, bytes.length])));
  removeObject = (hash: string) =>
    Effect.sync(() => {
      this.cache.delete(hash);
    });
  usage = () =>
    Effect.succeed(
      [...this.files.values(), ...this.cache.values()].reduce(
        (sum, bytes) => sum + bytes.length,
        JSON.stringify(this.journal).length,
      ),
    );
  active = (path: string) => this.opened.has(path);
  changed = () => {};
}
export class SelectiveRepository implements SelectiveRemote {
  snapshot: InventorySnapshot = {
    revision: null,
    consolidationHash: null,
    vaults: [],
    inventory: { files: [] },
  };
  readonly objects = new Map<string, Uint8Array>();
  readonly downloads: string[] = [];
  read: SelectiveRemote["read"] = () => Effect.succeed(structuredClone(this.snapshot));
  object = (reference: ObjectReference, limit: number) =>
    attempt("Cannot fetch fixture object.", () => {
      if (!Number.isSafeInteger(limit)) throw new Error("Transport needs a finite byte bound.");
      if (reference.bytes > limit) throw new Error("Limit exceeded.");
      this.downloads.push(reference.hash);
      const bytes = this.objects.get(reference.hash);
      if (!bytes) throw new Error("Missing object.");
      verifyObject(bytes, reference);
      return bytes.slice();
    });
  put = (bytes: Uint8Array) =>
    Effect.sync(() => {
      const reference = objectReference(bytes);
      this.objects.set(reference.hash, bytes.slice());
      return reference;
    });
  publish: SelectiveRemote["publish"] = (base, vault, files) =>
    Effect.sync(() => {
      if (base.revision !== this.snapshot.revision)
        return { published: false, revision: this.snapshot.revision };
      const revision = crypto.randomUUID();
      this.snapshot = {
        revision,
        consolidationHash: base.consolidationHash,
        vaults: [vault],
        inventory: { files: structuredClone(files) },
      };
      return { published: true, revision };
    });
  release = () => Effect.void;
  clear = () => Effect.void;
}
export const selectiveFixture = Effect.fn("fixture.selective")(function* () {
  const repository = new SelectiveRepository();
  const connect = (device = new SelectiveDevice(), limits = { ...selectiveLimits }) =>
    Effect.gen(function* () {
      const engine = yield* Effect.acquireRelease(
        Effect.sync(() =>
          createSelectiveEngine({ root: "Vault", name: "Vault" }, device, repository, () => limits),
        ),
        (value) => Effect.sync(() => value.close()),
      );
      yield* engine.open();
      return { device, engine, limits };
    });
  const a = yield* connect();
  return { repository, connect, a };
});
