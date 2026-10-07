import type { App, TFile } from "obsidian";
import { io } from "../core/errors";
import type { LocalVault } from "../core/ports";
import type { Journal } from "../core/protocol";
import type { HistoryState } from "../core/history";
import { validPath } from "../core/protocol";
import { contentFromBytes, contentBytes, contentEqual, type FileContent } from "../core/content";
import { ensureFolder, validateStoragePath } from "./storage";

export class ObsidianVault implements LocalVault {
  constructor(
    private readonly app: App,
    private readonly localDirectory: string,
  ) {}

  private safe = (path: string): void => {
    if (!validPath(path)) throw new Error("Unsupported file path.");
    validateStoragePath(path);
  };
  private fileContent = async (file: TFile): Promise<FileContent> =>
    contentFromBytes(file.path, new Uint8Array(await this.app.vault.readBinary(file)));

  scan = () =>
    io("Cannot read saved files from this vault.", async () => {
      const files = new Map<string, FileContent>();
      for (const file of this.app.vault.getFiles()) {
        if (file.path.split("/").some((segment) => segment.startsWith("."))) continue;
        this.safe(file.path);
        files.set(file.path, await this.fileContent(file));
      }
      return files;
    });
  read = (path: string) =>
    io("Cannot read the local file.", async () => {
      this.safe(path);
      const file = this.app.vault.getFileByPath(path);
      return file ? this.fileContent(file) : null;
    });
  private async updateFile(
    file: TFile,
    expected: FileContent | null,
    next: FileContent | null,
  ): Promise<void> {
    if (next?.type === "text" && expected?.type === "text") {
      await this.app.vault.process(file, (current) => {
        const content = { type: "text" as const, value: current };
        if (!contentEqual(content, expected) && !contentEqual(content, next))
          throw new Error("Concurrent local edit.");
        return next.value;
      });
      return;
    }
    const current = await this.fileContent(file);
    if (contentEqual(current, next)) return;
    if (!contentEqual(current, expected)) throw new Error("Concurrent local edit.");
    if (next === null) await this.app.fileManager.trashFile(file);
    else await this.app.vault.modifyBinary(file, contentBytes(next).buffer as ArrayBuffer);
  }
  private async createFile(path: string, content: FileContent): Promise<void> {
    const folderAtPath = this.app.vault.getFolderByPath(path);
    if (folderAtPath) {
      if (folderAtPath.children.length > 0) throw new Error("A nonempty folder blocks this file.");
      await this.app.fileManager.trashFile(folderAtPath);
    }
    const segments = path.split("/");
    segments.pop();
    let folder = "";
    for (const segment of segments) {
      folder = folder ? `${folder}/${segment}` : segment;
      if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
    }
    await this.app.vault.createBinary(path, contentBytes(content).buffer as ArrayBuffer);
  }
  write = (path: string, expected: FileContent | null, next: FileContent | null) =>
    io(
      `Cannot apply ${path}: the file may have changed during sync. Your content was preserved.`,
      async () => {
        this.safe(path);
        const file = this.app.vault.getFileByPath(path);
        if (file) {
          await this.updateFile(file, expected, next);
          return;
        }
        if (expected !== null) throw new Error("File disappeared during sync.");
        if (next !== null) await this.createFile(path, next);
      },
    );
  load = () =>
    io("Cannot load Gitbin's local journal.", async (): Promise<unknown> => {
      const adapter = this.app.vault.adapter;
      const file = this.localDirectory + "/journal.json";
      validateStoragePath(file);
      if (!(await adapter.exists(file))) return null;
      return JSON.parse(await adapter.read(file)) as unknown;
    });
  loadHistory = () =>
    io("Cannot load local sync history.", async (): Promise<unknown> => {
      const adapter = this.app.vault.adapter;
      const file = `${this.localDirectory}/history.json`;
      validateStoragePath(file);
      return (await adapter.exists(file))
        ? (JSON.parse(await adapter.read(file)) as unknown)
        : null;
    });
  saveHistory = (history: HistoryState) =>
    io("Cannot save local sync history.", async () => {
      const adapter = this.app.vault.adapter;
      await ensureFolder(adapter, this.localDirectory);
      const file = `${this.localDirectory}/history.json`;
      validateStoragePath(file);
      const data = JSON.stringify(history);
      if (await adapter.exists(file)) await adapter.process(file, () => data);
      else await adapter.write(file, data);
    });
  save = (journal: Journal) =>
    io("Cannot persist the local journal. Sync stopped before publishing.", async () => {
      const adapter = this.app.vault.adapter;
      await ensureFolder(adapter, this.localDirectory);
      const file = this.localDirectory + "/journal.json";
      validateStoragePath(file);
      const data = JSON.stringify(journal);
      if (await adapter.exists(file)) await adapter.process(file, () => data);
      else await adapter.write(file, data);
    });
}
