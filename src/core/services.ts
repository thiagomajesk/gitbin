import { Context, Effect, Layer } from "effect";
import { createSyncEngine, type SyncEngine } from "./engine";
import type { GitRemote, LocalVault } from "./ports";
import type { Registration } from "./protocol";

export const LocalVaultService = Context.Service<LocalVault>("gitbin/LocalVault");
export const GitRemoteService = Context.Service<GitRemote>("gitbin/GitRemote");
export const SyncEngineService = Context.Service<SyncEngine>("gitbin/SyncEngine");

export const syncEngineLayer = (vault: Registration) =>
  Layer.effect(
    SyncEngineService,
    Effect.gen(function* () {
      const local = yield* LocalVaultService;
      const remote = yield* GitRemoteService;
      const engine = yield* Effect.acquireRelease(
        Effect.sync(() => createSyncEngine(vault, local, remote)),
        (engine) => Effect.sync(() => engine.close()),
      );
      yield* engine.open();
      return engine;
    }),
  );
