import { textContent } from "../src/core/content";
import { Context, Effect, Exit, Layer, Scope } from "effect";
import { afterEach, expect, it, vi } from "vitest";
import { FileDocument } from "../src/core/file";
import type { GitRemote } from "../src/core/ports";
import {
  GitRemoteService,
  LocalVaultService,
  SyncEngineService,
  syncEngineLayer,
} from "../src/core/services";
import { MemoryVault } from "./helpers";

afterEach(() => vi.restoreAllMocks());
const registration = { name: "Personal", root: "personal" };
const remote: GitRemote = {
  read: () => Effect.die("Unexpected network access during local capture"),
  publish: () => Effect.die("Unexpected publish during local capture"),
};
function services(local: MemoryVault) {
  return syncEngineLayer(registration).pipe(
    Layer.provide(
      Layer.merge(Layer.succeed(LocalVaultService, local), Layer.succeed(GitRemoteService, remote)),
    ),
  );
}
it("releases CRDT documents when the service scope closes", async () => {
  const destroy = vi.spyOn(FileDocument.prototype, "destroy");
  const local = new MemoryVault();
  local.files.set("FileDocument.md", "Offline content");
  await Effect.runPromise(
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const context = yield* Layer.buildWithScope(services(local), scope);
      const engine = Context.get(context, SyncEngineService);
      yield* engine.capture();
      expect(destroy).not.toHaveBeenCalled();
      expect(local.journal?.files).toHaveLength(1);
      yield* Scope.close(scope, Exit.void);
    }),
  );
  expect(destroy).toHaveBeenCalledOnce();
});
it("releases already restored documents if opening a journal fails", async () => {
  const destroy = vi.spyOn(FileDocument.prototype, "destroy");
  const seed = new FileDocument(crypto.randomUUID());
  seed.move("FileDocument.md");
  seed.edit(textContent("Saved content"));
  const stored = seed.stored();
  seed.destroy();
  destroy.mockClear();
  const local = new MemoryVault();
  local.journal = {
    vaultRoot: registration.root,
    files: [stored, stored],
    intents: [],
  };
  await Effect.runPromise(
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const result = yield* Effect.exit(Layer.buildWithScope(services(local), scope));
      expect(Exit.isFailure(result)).toBe(true);
      yield* Scope.close(scope, result);
    }),
  );
  expect(destroy).toHaveBeenCalledOnce();
});
