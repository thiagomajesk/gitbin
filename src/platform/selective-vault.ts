import type { App, TFile } from "obsidian";
import type { AvailabilityJournal } from "../core/availability";
import { io } from "../core/errors";
import { type ObjectReference, objectReference, verifyObject } from "../core/inventory";
import { hiddenPath } from "../core/path-rules";
import { validPath } from "../core/protocol";
import type { SelectiveVault } from "../core/selective-ports";
import { ensureFolder } from "./storage";

export class SelectiveObsidianVault implements SelectiveVault {
  constructor(
    private readonly app: App,
    private readonly directory: string,
    readonly active: (path: string) => boolean,
    readonly changed: () => void,
    private readonly expected: (path: string, text: string) => void,
  ) {}

  private safe(path: string): void {
    if (!validPath(path)) throw new Error("Unsupported vault path.");
  }
  private objectPath(hash: string): string {
    if (!/^[a-f0-9]{40}$/.test(hash)) throw new Error("Invalid local object identity.");
    return this.directory + "/objects/" + hash;
  }
  private async readFile(path: string, limit: number): Promise<Uint8Array | null> {
    this.safe(path);
    const file = this.app.vault.getFileByPath(path);
    if (!file) return null;
    const stat = await this.app.vault.adapter.stat(path);
    if (!stat || stat.size > limit)
      throw new Error(
        "This local file exceeds the device's processing limit. Its bytes were preserved.",
      );
    const bytes = new Uint8Array(await this.app.vault.readBinary(file));
    if (bytes.length > limit)
      throw new Error("The file grew while being read. Its bytes were preserved.");
    return bytes;
  }
  list = () =>
    io(
      "Cannot list vault files.",
      async () =>
        new Map(
          this.app.vault
            .getFiles()
            .filter((file) => !hiddenPath(file.path))
            .map((file) => [file.path, { bytes: file.stat.size, modified: file.stat.mtime }]),
        ),
    );
  read = (path: string, limit: number) =>
    io("Cannot read this file within the device limit.", () => this.readFile(path, limit));

  private async writeExisting(
    file: TFile,
    before: ObjectReference | null,
    after: Uint8Array | null,
    unload: boolean,
  ): Promise<void> {
    const current = await this.readFile(file.path, writeLimit(before, after));
    if (!current) throw new Error("Local file disappeared during an update.");
    if (unload && this.active(file.path))
      throw new Error("The file was opened and remains protected.");
    const hash = objectReference(current).hash;
    if (after && hash === objectReference(after).hash) return;
    if (!before || hash !== before.hash)
      throw new Error("A local edit was preserved. Retry sync to capture it.");
    if (after === null) {
      const path = file.path;
      await this.app.fileManager.trashFile(file);
      await this.pruneParents(path);
      return;
    }
    await this.replaceExisting(file, before, current, after, unload);
  }
  private async pruneParents(path: string): Promise<void> {
    const parts = path.split("/");
    parts.pop();
    while (parts.length > 0) {
      const parent = parts.join("/");
      const folder = this.app.vault.getFolderByPath(parent);
      if (!folder) return;
      const children = await this.app.vault.adapter.list(parent);
      if (children.files.length || children.folders.length) return;
      await this.app.fileManager.trashFile(folder);
      parts.pop();
    }
  }
  private async replaceExisting(
    file: TFile,
    before: ObjectReference,
    current: Uint8Array,
    after: Uint8Array,
    unload: boolean,
  ): Promise<void> {
    const text = utf8(after);
    if (text !== null && utf8(current) !== null) {
      this.expected(file.path, text);
      await this.app.vault.process(file, (value) => {
        if (unload && this.active(file.path))
          throw new Error("The file was opened and remains protected.");
        if (objectReference(new TextEncoder().encode(value)).hash !== before.hash && value !== text)
          throw new Error("Concurrent local edit was preserved.");
        return text;
      });
    } else await this.app.vault.modifyBinary(file, after.slice().buffer);
  }
  write = (
    path: string,
    before: ObjectReference | null,
    after: Uint8Array | null,
    unload = false,
  ) =>
    io("Cannot safely update " + path + ". Local changes were preserved.", async () => {
      this.safe(path);
      const file = this.app.vault.getFileByPath(path);
      if (file) {
        await this.writeExisting(file, before, after, unload);
        return;
      }
      if (after === null) return;
      if (before !== null) throw new Error("Local file disappeared during an update.");
      await this.preparePath(path);
      const text = utf8(after);
      if (text !== null) this.expected(path, text);
      await this.app.vault.createBinary(path, after.slice().buffer);
    });
  private async preparePath(path: string): Promise<void> {
    const blockingFolder = this.app.vault.getFolderByPath(path);
    if (blockingFolder) {
      if (blockingFolder.children.length)
        throw new Error("A nonempty folder blocks the downloaded file.");
      await this.app.fileManager.trashFile(blockingFolder);
    }
    const parent = path.split("/").slice(0, -1);
    let folder = "";
    for (const segment of parent) {
      folder = folder ? folder + "/" + segment : segment;
      if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
    }
  }

  load = () =>
    io("Cannot restore download availability.", async (): Promise<unknown> => {
      const adapter = this.app.vault.adapter;
      const current = this.directory + "/journal.json";
      const next = current + ".next";
      if (await adapter.exists(next)) {
        try {
          return await this.readJournal(next);
        } catch {
          if (!(await adapter.exists(current)))
            throw new Error("Interrupted availability journal is damaged.");
        }
      }
      return (await adapter.exists(current)) ? await this.readJournal(current) : null;
    });
  private async readJournal(path: string): Promise<unknown> {
    return JSON.parse(await this.app.vault.adapter.read(path));
  }
  save = (journal: AvailabilityJournal) =>
    io("Cannot persist download availability.", async () => {
      const adapter = this.app.vault.adapter;
      await ensureFolder(adapter, this.directory);
      const path = this.directory + "/journal.json";
      const serialized = JSON.stringify(journal);
      await adapter.write(path + ".next", serialized);
      if ((await adapter.read(path + ".next")) !== serialized)
        throw new Error("Incomplete availability journal write.");
      if (await adapter.exists(path)) await adapter.remove(path);
      await adapter.rename(path + ".next", path);
    });
  put = (bytes: Uint8Array) =>
    io("Cannot retain file bytes before saving references.", async () => {
      const reference = objectReference(bytes);
      const adapter = this.app.vault.adapter;
      const path = this.objectPath(reference.hash);
      await ensureFolder(adapter, this.directory + "/objects");
      if (!(await adapter.exists(path))) await adapter.writeBinary(path, bytes.slice().buffer);
      verifyObject(new Uint8Array(await adapter.readBinary(path)), reference);
      return reference;
    });
  object = (reference: ObjectReference, limit: number) =>
    io("Cannot read saved content safely.", async () => {
      if (reference.bytes > limit) throw new Error("Saved object exceeds this device's limit.");
      const path = this.objectPath(reference.hash);
      const adapter = this.app.vault.adapter;
      const stat = await adapter.stat(path);
      if (!stat) return null;
      if (stat.size > limit) throw new Error("Saved object exceeds this device's limit.");
      const bytes = new Uint8Array(await adapter.readBinary(path));
      verifyObject(bytes, reference);
      return bytes;
    });
  hasObject = (reference: ObjectReference) =>
    io("Cannot inspect saved content.", async () => {
      const stat = await this.app.vault.adapter.stat(this.objectPath(reference.hash));
      return stat?.type === "file" && stat.size === reference.bytes;
    });
  objects = () =>
    io("Cannot inspect saved downloads.", async () => {
      const adapter = this.app.vault.adapter;
      const directory = this.directory + "/objects";
      const result = new Map<string, number>();
      if (!(await adapter.exists(directory))) return result;
      for (const path of (await adapter.list(directory)).files) {
        const hash = path.slice(path.lastIndexOf("/") + 1);
        if (/^[a-f0-9]{40}$/.test(hash)) result.set(hash, (await adapter.stat(path))?.size ?? 0);
      }
      return result;
    });
  removeObject = (hash: string) =>
    io("Cannot release unused downloaded content.", async () => {
      const path = this.objectPath(hash);
      if (await this.app.vault.adapter.exists(path)) await this.app.vault.adapter.remove(path);
    });
  usage = () =>
    io("Cannot measure managed storage.", async () => {
      const visible = this.app.vault
        .getFiles()
        .filter((file) => !hiddenPath(file.path))
        .reduce((sum, file) => sum + file.stat.size, 0);
      return visible + (await this.directoryBytes(this.directory));
    });
  private async directoryBytes(path: string): Promise<number> {
    const stat = await this.app.vault.adapter.stat(path);
    if (!stat) return 0;
    if (stat.type === "file") return stat.size;
    const children = await this.app.vault.adapter.list(path);
    let total = 0;
    for (const child of [...children.files, ...children.folders])
      total += await this.directoryBytes(child);
    return total;
  }
}

function utf8(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

function writeLimit(before: ObjectReference | null, after: Uint8Array | null): number {
  return Math.max(before?.bytes ?? 0, after?.length ?? 0);
}
