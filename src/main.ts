import { Context, Effect, Exit, Layer, Scope } from "effect";
import { Notice, Plugin } from "obsidian";
import {
  type Authentication,
  readCredentials,
  scopedCredentials,
  storeCredentials,
} from "./auth/credentials";
import {
  type Config,
  connectionChanged,
  defaults,
  loadConfig,
  type SyncPreferences,
} from "./core/config";
import type { SyncEngine } from "./core/engine";
import { attempt, explain, io, retryable, SyncError } from "./core/errors";
import { hashText } from "./core/hash";
import type { GitRemote } from "./core/ports";
import {
  checkRoot,
  decode,
  Registration,
  type Registration as VaultRegistration,
} from "./core/protocol";
import {
  GitRemoteService,
  LocalVaultService,
  SyncEngineService,
  syncEngineLayer,
} from "./core/services";
import { checkRemote, createGitRemote } from "./git/remote";
import { commitAuthor, deviceName } from "./platform/device";
import { gitCache } from "./platform/git-cache";
import { obsidianFetch } from "./platform/http";
import { createRetryLoop, type Outcome } from "./platform/retry";
import { ObsidianVault } from "./platform/vault";
import { HistoryView, historyType } from "./ui/history-view";
import { GitbinSettings } from "./ui/settings";
import type { RepositoryInspection } from "./ui/setup-types";
import { createUiStore } from "./ui/store";
import "./styles.css";
import { readSetupCode } from "./auth/setup-code";
import { exportSetup } from "./auth/setup-transfer";
import { maintenanceStorage } from "./platform/consolidation";
import { pluginActions } from "./ui/actions";
import { ConsolidationModal } from "./ui/consolidation-modal";
import { SetupImportModal, SetupQrModal } from "./ui/setup-transfer-modal";
import { syncIssue } from "./ui/sync-issue";

export default class GitbinPlugin extends Plugin {
  config: Config = defaults();
  readonly ui = createUiStore({ config: this.config, status: "Ready", error: null });
  private settingsTab: GitbinSettings | undefined;
  private retryScope = Scope.makeUnsafe();
  private retryLoop = createRetryLoop(
    {
      run: (manual) => Effect.promise(() => this.backgroundSync(manual)),
      online: () => navigator.onLine,
      status: (message) => {
        this.setStatus(message);
        this.ui.update({ stale: true });
      },
      random: Math.random,
      interval: () => (this.config.autoSync ? this.config.remoteCheckInterval : null),
    },
    this.retryScope,
  );
  private lastFailure: unknown;
  private engine: SyncEngine | undefined;
  private engineScope: Scope.Closeable | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private uploadTimer: number | undefined;
  private captureTimer: number | undefined;
  private stopped = false;
  private syncing = false;
  private attached = false;
  private layoutReady = false;
  private connecting = false;
  private maintaining = false;
  private consolidationModal: ConsolidationModal | undefined;
  private transferModal: SetupImportModal | SetupQrModal | undefined;

  override async onload(): Promise<void> {
    const raw: unknown = await this.loadData();
    this.config = loadConfig(raw);
    this.registerObsidianProtocolHandler("gitbin-setup", (params) => {
      this.app.workspace.onLayoutReady(() => {
        try {
          const sealed = readSetupCode(params.data ?? "");
          if (this.transferModal) return;
          const actions = pluginActions(this);
          this.transferModal = new SetupImportModal(this.app, sealed, actions, () => {
            this.transferModal = undefined;
          });
          this.transferModal.open();
        } catch (cause) {
          new Notice(explain(cause));
        }
      });
    });
    this.register(() => this.transferModal?.close());
    const ribbon = this.addRibbonIcon("folder-git-2", "", () => this.openHistory());
    ribbon.removeAttribute("aria-label");
    ribbon.setAttribute("aria-labelledby", "gitbin-ribbon-label");
    ribbon.createSpan({
      text: "Gitbin",
      cls: "gitbin:sr-only",
      attr: { id: "gitbin-ribbon-label" },
    });
    this.app.workspace.onLayoutReady(() => {
      this.layoutReady = true;
    });
    this.registerView(historyType, (leaf) => new HistoryView(leaf, this));
    this.registerDomEvent(window, "online", () => this.resumeSync());
    this.registerDomEvent(window, "focus", () => this.resumeSync());
    this.registerDomEvent(window, "offline", () => {
      this.ui.update({ stale: true });
      this.setStatus("Offline · Changes stay on this device");
    });
    this.setStatus("Ready");
    this.ui.update({
      vaults: this.config.vaults,
      checkedAt: this.config.checkedAt ?? 0,
      stale: true,
      pending: this.config.pending,
    });
    this.settingsTab = new GitbinSettings(this.app, this);
    this.addSettingTab(this.settingsTab);
    this.addCommand({
      id: "sync",
      name: "Sync now",
      callback: () => this.requestSync(),
    });
    this.addCommand({ id: "open", name: "Open sync history", callback: () => this.openHistory() });
    this.registerEvent(this.app.vault.on("modify", () => this.scheduleCapture()));
    this.registerEvent(this.app.vault.on("create", () => this.scheduleCapture()));
    this.registerEvent(this.app.vault.on("delete", () => this.scheduleCapture()));
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (this.attached) {
          void this.enqueue(() =>
            this.engine ? this.engine.rename(oldPath, file.path) : Effect.void,
          );
        }
        this.scheduleCapture();
      }),
    );
    await this.restoreSync();
  }
  private resumeSync(): void {
    if (this.config.setupComplete && this.config.autoSync)
      void Effect.runPromise(this.retryLoop.wake());
  }
  private async restoreSync(): Promise<void> {
    if (!this.config.setupComplete || !this.config.remote) return;
    await this.enqueue(() => this.openEngine().pipe(Effect.flatMap(() => this.captureEdits())));
    void Effect.runPromise(this.retryLoop.start());
  }

  openSettings(): void {
    const settings = this.app as typeof this.app & {
      setting: { open(): void; openTabById(id: string): void };
    };
    settings.setting.open();
    settings.setting.openTabById(this.manifest.id);
  }
  reinitialize(): void {
    this.consolidate(true);
  }
  consolidate(reinitialize = false): void {
    if (this.maintaining || !this.config.remote) return;
    this.maintaining = true;
    const { remote, root } = this.config;
    const modal = new ConsolidationModal(
      this.app,
      {
        reinitialize,
        vaults: [...new Set([root, ...this.config.vaults.map((row) => row.vault.root)])],
      },
      async (report) => {
        if (this.config.remote !== remote || this.config.root !== root)
          throw new Error("Repository settings changed. Close this dialog and try again.");
        const success = await this.enqueue(() => this.runMaintenance(reinitialize, report));
        if (!success)
          throw new Error(
            "Repository maintenance did not finish. Close this dialog and try again to recover any saved checkpoint.",
          );
      },
      () => {
        if (this.consolidationModal !== modal) return;
        this.maintaining = false;
        this.consolidationModal = undefined;
      },
    );
    this.consolidationModal = modal;
    modal.open();
  }
  private runMaintenance(reinitialize: boolean, report: (message: string) => void) {
    return Effect.gen({ self: this }, function* () {
      yield* Effect.sync(() => report("Saving local changes…"));
      yield* this.captureEdits();
      yield* this.closeEngine();
      const remote = yield* this.remote(this.config);
      const storage = maintenanceStorage(this.app, this.storage(this.config));
      yield* Effect.sync(() => report("Checking for an unfinished operation…"));
      const pending = yield* storage.pending();
      if (
        pending &&
        (yield* remote.maintenance.status(pending.expected, pending.revision)) === "stale"
      ) {
        yield* storage.discardStale();
      } else if (pending) {
        yield* remote.maintenance.apply(pending.expected, pending.revision, report);
        report("Updating local metadata…");
        yield* storage.install();
        yield* io("Cannot finish maintenance.", () => this.finishConsolidation(reinitialize));
        return;
      }
      const device = yield* storage.loadDevice();
      const preview = yield* remote.maintenance.preview(
        device,
        reinitialize
          ? [...new Set([this.config.root, ...this.config.vaults.map((row) => row.vault.root)])]
          : undefined,
        report,
      );
      report("Saving recovery checkpoint…");
      yield* storage.stage(preview);
      yield* remote.maintenance.apply(preview.sourceRevision, preview.revision, report);
      report("Updating local metadata…");
      yield* storage.install();
      yield* io("Cannot finish maintenance.", () => this.finishConsolidation(reinitialize));
    });
  }
  private async finishConsolidation(reinitialize = false): Promise<void> {
    this.config = { ...this.config, lastRevision: null };
    await this.saveData(this.config);
    this.ui.update({
      history: [],
      config: this.config,
      status: reinitialize ? "Repository reinitialized" : "Repository consolidated",
      error: null,
    });
  }
  scanToSync(): void {
    try {
      const payload = exportSetup(this.config, this.savedAuthentication());
      this.transferModal?.close();
      this.transferModal = new SetupQrModal(this.app, payload, () => {
        this.transferModal = undefined;
      });
      this.transferModal.open();
    } catch (cause) {
      new Notice(cause instanceof Error ? cause.message : "Cannot generate this setup code.");
    }
  }
  openHistory(): void {
    void this.showHistory().catch((error: unknown) => this.reportFailure(error));
  }
  private async showHistory(): Promise<void> {
    const workspace = this.app.workspace;
    const leaf = workspace.getLeavesOfType(historyType)[0] ?? workspace.getLeaf("tab");
    await leaf.setViewState({ type: historyType, active: true });
    await workspace.revealLeaf(leaf);
  }
  private async backgroundSync(manual: boolean): Promise<Outcome> {
    if (!this.backgroundReady()) return "success";
    this.lastFailure = undefined;
    if (!manual && !this.automaticSyncReady()) return "success";
    const success = await this.synchronize();
    return this.syncOutcome(success);
  }
  private automaticSyncReady(): boolean {
    return this.config.autoSync && this.uploadTimer === undefined;
  }
  private backgroundReady(): boolean {
    return this.config.setupComplete && this.layoutReady;
  }
  private syncOutcome(success: boolean): Outcome {
    if (this.lastFailure) return this.failureOutcome();
    return success ? "success" : "stop";
  }
  private failureOutcome(): Outcome {
    return retryable(this.lastFailure) ? "retry" : "stop";
  }
  private inspectStatus = Effect.fn("plugin.inspectStatus")(function* (this: GitbinPlugin) {
    const remote = yield* this.remote(this.config);
    const vaults = yield* remote.inspect(
      { root: this.config.root, name: this.app.vault.getName() },
      this.config.lastRevision,
    );
    const checkedAt = Date.now();
    this.config = { ...this.config, vaults, checkedAt };
    yield* io("Cannot cache vault status.", () => this.saveData(this.config));
    this.ui.update({ config: this.config, vaults, checkedAt, stale: false });
  });

  private requestSync(): void {
    if (this.config.setupComplete) {
      void Effect.runPromise(this.retryLoop.request());
      return;
    }
    this.openHistory();
  }

  private setStatus(text: string): void {
    this.ui.update({ config: this.config, status: text, error: null });
  }

  saveSyncPreferences(preferences: SyncPreferences): Promise<boolean> {
    return this.configure({ ...this.config, ...preferences });
  }

  configure(next: Config): Promise<boolean> {
    next = {
      ...next,
      remote: next.remote.trim(),
      root: next.root.trim(),
      username: next.username.trim(),
    };
    return this.enqueue(() =>
      Effect.gen({ self: this }, function* () {
        yield* attempt("Invalid settings.", () => loadConfig(next));
        yield* attempt("Check the repository and vault folder.", () => {
          this.checkConnection(next);
        });
        const changed = connectionChanged(next, this.config);
        if (changed)
          next = {
            ...next,
            connectedAt: Date.now(),
            lastRevision: null,
            lastSync: null,
            vaults: [],
            checkedAt: null,
          };
        else
          next = {
            ...next,
            lastRevision: this.config.lastRevision,
            lastSync: this.config.lastSync,
            vaults: this.config.vaults,
            checkedAt: this.config.checkedAt,
            pending: this.config.pending,
          };
        yield* io("Cannot save Gitbin settings.", () => this.saveData(next));
        if (changed) {
          yield* this.closeEngine();
          this.attached = false;
          this.setStatus("Ready");
        }
        this.config = next;
        this.ui.update({ config: this.config, error: null });
        this.restartSyncScheduling();
      }),
    );
  }

  private restartSyncScheduling(): void {
    window.clearTimeout(this.uploadTimer);
    this.uploadTimer = undefined;
    if (!this.config.setupComplete) return;
    void Effect.runPromise(this.retryLoop.start());
    if (this.config.pending) this.scheduleUpload();
  }
  private checkConnection(next: Config): void {
    if (next.remote) checkRemote(next.remote);
    if (!checkRoot(next.root)) throw new Error("Choose a portable vault folder.");
  }
  private closeEngine = Effect.fn("plugin.closeEngine")(function* (this: GitbinPlugin) {
    if (this.engineScope) yield* Scope.close(this.engineScope, Exit.void);
    this.engineScope = undefined;
    this.engine = undefined;
  });

  private buildEngine = Effect.fn("plugin.buildEngine")(function* (
    this: GitbinPlugin,
    vault: VaultRegistration,
    local: ObsidianVault,
    remote: GitRemote,
  ) {
    const scope = yield* Scope.make();
    const layer = syncEngineLayer(vault).pipe(
      Layer.provide(
        Layer.merge(
          Layer.succeed(LocalVaultService, local),
          Layer.succeed(GitRemoteService, remote),
        ),
      ),
    );
    const context = yield* Layer.buildWithScope(layer, scope).pipe(
      Effect.onError(() => Scope.close(scope, Exit.void)),
    );
    return { engine: Context.get(context, SyncEngineService), scope };
  });

  private enqueue(task: () => Effect.Effect<unknown, SyncError>): Promise<boolean> {
    const run = this.queue
      .then(async () => {
        if (this.stopped) return false;
        return Effect.runPromise(
          Effect.suspend(task).pipe(
            Effect.match({
              onSuccess: () => true,
              onFailure: (error) => {
                this.reportFailure(error);
                return false;
              },
            }),
          ),
        );
      })
      .catch((error: unknown) => {
        this.reportFailure(error);
        return false;
      });
    this.queue = run;
    return run;
  }

  private reportFailure(error: unknown): void {
    this.lastFailure = error;
    this.ui.update({ stale: true });
    this.setStatus("Needs attention");
    const issue = syncIssue(error);
    this.ui.update({ error: explain(error), issue });
    if (!issue && !retryable(error)) new Notice(explain(error), 10000);
  }

  private storage(config: Config): string {
    const key = hashText(config.remote + "\n" + config.root).slice(0, 24);
    return this.app.vault.configDir + "/plugins/" + this.manifest.id + "/local/" + key;
  }
  private remote = Effect.fn("plugin.remote")(function* (
    this: GitbinPlugin,
    config: Config,
    authentication?: Authentication,
  ) {
    const device = yield* io("Cannot identify this device.", () =>
      deviceName(this.app.secretStorage),
    );
    return yield* attempt("Check the HTTPS repository URL.", () =>
      createGitRemote({
        fs: gitCache(this.app.vault.adapter, this.storage(config) + "/git"),
        identity: {
          author: commitAuthor(config, device),
          device,
        },
        network: { fetch: obsidianFetch, allowed: [new URL(config.remote).origin] },
        url: config.remote,
        credentials: scopedCredentials(
          config.remote,
          authentication
            ? authentication.credentials
            : readCredentials(
                config.secretId ? this.app.secretStorage.getSecret(config.secretId) : null,
              ),
        ),
      }),
    );
  });
  private openEngine = Effect.fn("plugin.openEngine")(function* (this: GitbinPlugin) {
    if (this.engine) return this.engine;
    const pending = yield* maintenanceStorage(this.app, this.storage(this.config)).pending();
    if (pending)
      return yield* new SyncError({
        message:
          "Finish the interrupted consolidation in Settings → Gitbin → Consolidate before syncing.",
      });
    const registration = yield* decode(Registration, {
      name: this.app.vault.getName(),
      root: this.config.root,
    });
    const remote = yield* this.remote(this.config);
    const local = new ObsidianVault(this.app, this.storage(this.config));
    const attached = yield* io("Cannot inspect local registration.", () =>
      this.app.vault.adapter.exists(this.storage(this.config) + "/journal.json"),
    );
    const { engine, scope } = yield* this.buildEngine(registration, local, remote);
    this.engineScope = scope;
    this.attached = attached;
    this.engine = engine;
    this.ui.update({ history: engine.history(), historyWarning: null });
    return engine;
  });
  async disconnect(): Promise<boolean> {
    await Effect.runPromise(this.retryLoop.stop());
    window.clearTimeout(this.uploadTimer);
    this.uploadTimer = undefined;
    const disconnected = await this.enqueue(() =>
      Effect.gen({ self: this }, function* () {
        yield* this.captureEdits();
        const next = { ...this.config, setupComplete: false };
        yield* io("Cannot save the disconnected state.", () => this.saveData(next));
        yield* this.closeEngine();
        window.clearTimeout(this.captureTimer);
        this.attached = false;
        this.config = next;
        this.setStatus("Disconnected");
        this.ui.update({ stale: true });
      }),
    );
    if (!disconnected && this.config.setupComplete) void Effect.runPromise(this.retryLoop.start());
    return disconnected;
  }
  savedAuthentication(): Authentication | null {
    if (!this.config.secretId) return null;
    const credentials = readCredentials(this.app.secretStorage.getSecret(this.config.secretId));
    return credentials ? { remote: this.config.remote, credentials } : null;
  }
  async inspectRepository(connection: Authentication): Promise<RepositoryInspection | null> {
    let inspection: RepositoryInspection | null = null;
    await this.enqueue(() =>
      Effect.gen({ self: this }, function* () {
        const config = {
          ...this.config,
          remote: connection.remote.trim(),
          root: this.app.vault.getName(),
          username: connection.credentials?.username ?? "",
        };
        const remote = yield* this.remote(config, connection);
        const snapshot = yield* remote.read({
          root: config.root,
          name: this.app.vault.getName(),
        });
        inspection = {
          vaults: snapshot.vaults,
        };
        this.setStatus("Repository connected");
      }),
    );
    return inspection;
  }
  private async prepareSetup(next: Config, authentication: Authentication): Promise<boolean> {
    if (authentication.remote !== next.remote) return false;
    const secretId = authentication.credentials
      ? "gitbin-" + hashText(next.remote + "\n" + next.username).slice(0, 24)
      : "";
    const saved = await this.enqueue(() =>
      attempt("Cannot save Git credentials in Obsidian's secret storage.", () => {
        if (authentication.credentials)
          this.app.secretStorage.setSecret(secretId, storeCredentials(authentication.credentials));
      }),
    );
    if (!saved) return false;
    return this.configure({ ...next, secretId, autoSync: false, setupComplete: false });
  }
  async finishSetup(next: Config, authentication: Authentication): Promise<boolean> {
    if (this.connecting || this.config.setupComplete) return false;
    this.connecting = true;
    try {
      return await this.completeSetup(next, authentication);
    } finally {
      this.connecting = false;
    }
  }

  private async completeSetup(next: Config, authentication: Authentication): Promise<boolean> {
    if (!(await this.prepareSetup(next, authentication))) return false;
    if (!(await this.synchronize())) return false;
    const completed = await this.configure({
      ...this.config,
      autoSync: next.autoSync,
      setupComplete: true,
      connectedAt: Date.now(),
    });
    if (completed) this.openHistory();
    return completed;
  }

  manualSync(): Promise<boolean> {
    return Effect.runPromise(this.retryLoop.request());
  }

  synchronize(): Promise<boolean> {
    if (!this.layoutReady) {
      new Notice("Gitbin: wait for the vault to finish loading before syncing.");
      return Promise.resolve(false);
    }
    if (this.syncing || this.maintaining) return Promise.resolve(false);
    this.syncing = true;
    window.clearTimeout(this.uploadTimer);
    this.uploadTimer = undefined;
    return this.enqueue(() =>
      Effect.gen({ self: this }, function* () {
        this.setStatus("Syncing…");
        const engine = yield* this.openEngine();
        const result = yield* engine.sync();
        this.ui.update({ history: engine.history(), historyWarning: result.historyWarning });
        this.attached = true;
        if (result.published) {
          this.config = {
            ...this.config,
            lastRevision: result.revision,
            lastSync: Date.now(),
            pending: false,
          };
          yield* io("Cannot save the sync checkpoint.", () => this.saveData(this.config));
          this.ui.update({ pending: false });
          yield* this.inspectStatus().pipe(
            Effect.catch((error) =>
              Effect.sync(() => {
                this.lastFailure = error;
                this.ui.update({ stale: true });
              }),
            ),
          );
        }
        this.setStatus("Synced");
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            this.syncing = false;
          }),
        ),
      ),
    );
  }

  private savePending = Effect.fn("plugin.savePending")(function* (
    this: GitbinPlugin,
    changed: boolean,
  ) {
    if (!changed) return;
    this.config = { ...this.config, pending: true };
    yield* io("Cannot save pending sync state.", () => this.saveData(this.config));
    this.setStatus("Changes saved locally");
    this.ui.update({ pending: true });
  });
  private captureEdits = Effect.fn("plugin.captureEdits")(function* (this: GitbinPlugin) {
    if (!this.engine) return;
    const changed = yield* this.engine.capture();
    yield* this.savePending(changed);
  });
  private captureReady(): boolean {
    return this.layoutReady && this.attached && this.engine !== undefined;
  }

  private scheduleCapture(): void {
    if (this.stopped || !this.captureReady()) return;
    this.ui.update({ pending: true });
    this.scheduleUpload();
    window.clearTimeout(this.captureTimer);
    this.captureTimer = window.setTimeout(() => {
      void this.enqueue(() => this.captureEdits());
    }, 500);
  }

  private scheduleUpload(): void {
    window.clearTimeout(this.uploadTimer);
    this.uploadTimer = undefined;
    if (!this.config.setupComplete || !this.config.autoSync) return;
    this.uploadTimer = window.setTimeout(() => {
      this.uploadTimer = undefined;
      void Effect.runPromise(this.retryLoop.wake());
    }, this.config.uploadDelay);
  }

  override onunload(): void {
    this.stopped = true;
    this.consolidationModal?.close();
    this.settingsTab?.dispose();
    void Effect.runPromise(
      this.retryLoop.stop().pipe(Effect.andThen(Scope.close(this.retryScope, Exit.void))),
    );
    if (this.captureTimer) window.clearTimeout(this.captureTimer);
    window.clearTimeout(this.uploadTimer);
    this.uploadTimer = undefined;
    // Do not destroy CRDTs underneath an in-flight transaction.
    void this.queue.then(() => Effect.runPromise(this.closeEngine()));
  }
}
