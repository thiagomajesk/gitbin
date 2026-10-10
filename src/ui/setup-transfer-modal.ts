import { Effect } from "effect";
import { generate } from "lean-qr";
import {
  type App,
  ButtonComponent,
  Modal,
  Notice,
  ProgressBarComponent,
  TextComponent,
} from "obsidian";
import {
  createSetupCode,
  type SealedSetup,
  setupCodeRefreshMs,
  unlockSetupCode,
} from "../auth/setup-code";
import { checkSetupTarget, importSetup, type SyncSetupPayload } from "../auth/setup-transfer";
import { explain } from "../core/errors";
import type { SetupActions } from "./setup-types";

export function drawSetupQr(
  canvas: Parameters<ReturnType<typeof generate>["toCanvas"]>[0],
  uri: string,
): void {
  generate(uri).toCanvas(canvas, { pad: 4, on: [0, 0, 0], off: [255, 255, 255] });
}

export class SetupQrModal extends Modal {
  private timer: { window: Window; id: number } | undefined;
  constructor(
    app: App,
    private payload: SyncSetupPayload | null,
    private readonly closed: () => void,
  ) {
    super(app);
  }
  override onOpen(): void {
    this.setTitle("Scan to sync");
    this.modalEl.addClass("gitbin-setup-modal");
    this.contentEl.addClass("gitbin-setup-share");
    this.contentEl.createEl("p", {
      text: "Scan the QR code to sync your credentials with other devices",
    });
    const canvas = this.contentEl.createEl("canvas", {
      cls: "gitbin-setup-qr",
      attr: { role: "img", "aria-label": "Scan to sync QR code" },
    });
    canvas.hidden = true;
    const pin = this.contentEl.createEl("p", { cls: "gitbin-setup-pin" });
    const progressEl = this.contentEl.createDiv({
      cls: "gitbin-setup-progress",
      attr: {
        role: "progressbar",
        "aria-valuemin": "0",
        "aria-valuemax": "100",
        "aria-label": "Time until the code refreshes",
      },
    });
    const progress = new ProgressBarComponent(progressEl);
    progressEl.style.setProperty("--gitbin-code-refresh", `${setupCodeRefreshMs}ms`);
    progressEl.hidden = true;
    const status = this.contentEl.createEl("p", { cls: "setting-item-description" });
    if (this.payload) {
      const instruction = this.contentEl.createEl("p", {
        cls: "setting-item-description gitbin-setup-warning",
        text: "You need to have a vault named ",
      });
      instruction.createEl("strong", { text: this.payload.root });
      instruction.appendText(" for sync to work.");
    }
    this.contentEl.createEl("p", {
      cls: "setting-item-description",
      text: "Install and enable Gitbin in that vault before scanning.",
    });
    let refreshAt = 0;
    let generating = false;
    const refresh = async () => {
      if (!this.payload) return;
      generating = true;
      canvas.hidden = true;
      pin.setText("");
      progressEl.hidden = true;
      status.setText("Generating code…");
      try {
        const code = await Effect.runPromise(createSetupCode(this.payload));
        if (!this.payload) return;
        drawSetupQr(canvas, code.uri);
        pin.setText(code.pin);
        canvas.hidden = false;
        refreshAt = Date.now() + setupCodeRefreshMs;
        progress.setValue(100);
        progressEl.setAttribute("aria-valuenow", "100");
        progressEl.hidden = false;
        status.setText("Use the 6-digit code above to authenticate on your device");
      } catch (cause) {
        status.setText(explain(cause));
      } finally {
        generating = false;
      }
    };
    void refresh();
    const ownerWindow = this.contentEl.win;
    const id = ownerWindow.setInterval(() => {
      if (!refreshAt || generating) return;
      const seconds = Math.ceil((refreshAt - Date.now()) / 1000);
      if (seconds <= 0) {
        refreshAt = 0;
        void refresh();
      } else
        progressEl.setAttribute(
          "aria-valuenow",
          String((seconds / (setupCodeRefreshMs / 1000)) * 100),
        );
    }, 1000);
    this.timer = { window: ownerWindow, id };
  }
  override onClose(): void {
    if (this.timer) this.timer.window.clearInterval(this.timer.id);
    this.timer = undefined;
    this.payload = null;
    this.contentEl.empty();
    this.closed();
  }
}

export class SetupImportModal extends Modal {
  constructor(
    app: App,
    private sealed: SealedSetup | null,
    private readonly actions: SetupActions,
    private readonly closed: () => void,
  ) {
    super(app);
  }
  override onOpen(): void {
    this.modalEl.classList.add("gitbin-import-modal");
    this.setTitle("Enter the six-digit code");
    this.contentEl.createEl("p", { text: "Use the code shown below the QR on your desktop." });
    const input = new TextComponent(this.contentEl).setPlaceholder("000000");
    input.inputEl.setAttribute("aria-label", "Six-digit code");
    input.inputEl.inputMode = "numeric";
    input.inputEl.maxLength = 6;
    input.inputEl.autocomplete = "one-time-code";
    const error = this.contentEl.createEl("p", { cls: "gitbin-error", attr: { role: "alert" } });
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    new ButtonComponent(buttons).setButtonText("Cancel").onClick(() => this.close());
    const unlock = new ButtonComponent(buttons).setButtonText("Continue").setCta();
    unlock.onClick(async () => {
      if (!this.sealed) return;
      unlock.setDisabled(true).setButtonText("Checking…");
      input.setDisabled(true);
      error.setText("");
      try {
        const payload = await Effect.runPromise(
          unlockSetupCode(this.sealed, input.getValue().trim()),
        );
        if (!this.sealed) return;
        checkSetupTarget(this.actions, payload);
        input.setValue("");
        this.showConfirmation(payload);
      } catch (cause) {
        error.setText(explain(cause));
        unlock.setDisabled(false).setButtonText("Continue");
        input.setDisabled(false);
      }
    });
    input.inputEl.focus();
  }
  private showConfirmation(payload: SyncSetupPayload): void {
    this.sealed = null;
    this.contentEl.empty();
    this.setTitle("Sync this vault?");
    this.contentEl.createEl("p", { text: payload.remote });
    this.contentEl.createEl("p", { text: `Vault: ${payload.root}` });
    const error = this.contentEl.createEl("p", { cls: "gitbin-error", attr: { role: "alert" } });
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    new ButtonComponent(buttons).setButtonText("Cancel").onClick(() => this.close());
    const connect = new ButtonComponent(buttons).setButtonText("Connect and sync").setCta();
    connect.onClick(async () => {
      connect.setDisabled(true).setButtonText("Syncing…");
      error.setText("");
      try {
        await importSetup(this.actions, payload);
        new Notice("Gitbin: this vault is connected and synced.");
        this.close();
      } catch (cause) {
        error.setText(cause instanceof Error ? cause.message : "Could not connect. Try again.");
        connect.setDisabled(false).setButtonText("Connect and sync");
      }
    });
  }
  override onClose(): void {
    this.sealed = null;
    this.contentEl.empty();
    this.closed();
  }
}
