import type { App } from "obsidian";
import type { ConsolidationPreview } from "../git/consolidation";
import type { MigrationSnapshot } from "../maintenance/types";
import { ensureFolder } from "./storage";
import { Schema } from "effect";
import { Journal } from "../core/protocol";
import { binaryObject, BlobId } from "../core/blobs";

export function maintenanceStorage(app: App, directory: string) {
  const adapter = app.vault.adapter;
  const journalPath = directory + "/journal.json";
  const pendingPath = directory + "/consolidation.json";
  const replace = async (path: string, value: string) => {
    const temporary = path + ".next";
    await adapter.write(temporary, value);
    if ((await adapter.read(temporary)) !== value)
      throw new Error("Incomplete migration checkpoint write.");
    // Obsidian adapters cannot rename over an existing file. The durable checkpoint
    // retains both journals so recovery also works if removal succeeds but rename fails.
    if (await adapter.exists(path)) await adapter.remove(path);
    await adapter.rename(temporary, path);
  };
  const loadDevice = async (): Promise<MigrationSnapshot | null> => {
    if (!(await adapter.exists(journalPath))) return null;
    const journal = await adapter.read(journalPath);
    const raw = JSON.parse(journal) as { blobs?: unknown };
    const files = new Map([["journal.json", new TextEncoder().encode(journal)]]);
    for (const id of Schema.decodeUnknownSync(Schema.Array(BlobId))(raw.blobs ?? []))
      files.set(
        "blobs/" + id,
        new Uint8Array(await adapter.readBinary(directory + "/blobs/" + id)),
      );
    const historyPath = directory + "/history.json";
    if (await adapter.exists(historyPath))
      files.set("history.json", new TextEncoder().encode(await adapter.read(historyPath)));
    return { kind: "device", files };
  };
  const stage = async (preview: ConsolidationPreview) => {
    await ensureFolder(adapter, directory);
    if (await adapter.exists(pendingPath))
      throw new Error("Finish the pending consolidation first.");
    const original = (await adapter.exists(journalPath)) ? await adapter.read(journalPath) : null;
    if (original !== preview.originalJournal)
      throw new Error("Local journal changed since preview.");
    const migrated = preview.device?.files.get("journal.json");
    if (preview.device) {
      await ensureFolder(adapter, directory + "/blobs");
      for (const [path, bytes] of preview.device.files) {
        if (!path.startsWith("blobs/")) continue;
        binaryObject(path.slice(6), bytes);
        await adapter.writeBinary(directory + "/" + path, bytes.slice().buffer);
        binaryObject(
          path.slice(6),
          new Uint8Array(await adapter.readBinary(directory + "/" + path)),
        );
      }
    }
    await replace(
      pendingPath,
      JSON.stringify({
        expected: preview.sourceRevision,
        revision: preview.revision,
        original,
        migrated: migrated ? new TextDecoder().decode(migrated) : null,
      }),
    );
  };
  const pending = async () => {
    if (!(await adapter.exists(pendingPath))) return null;
    return Schema.decodeUnknownSync(
      Schema.Struct({
        expected: Schema.String,
        revision: Schema.String,
        original: Schema.NullOr(Schema.String),
        migrated: Schema.NullOr(Schema.String),
      }),
    )(JSON.parse(await adapter.read(pendingPath)));
  };
  const install = async () => {
    const record = await pending();
    if (!record) return;
    const current = (await adapter.exists(journalPath)) ? await adapter.read(journalPath) : null;
    if (current !== null && current !== record.original && current !== record.migrated)
      throw new Error("Local journal changed. Consolidation checkpoint preserved for recovery.");
    if (record.migrated) {
      Schema.decodeUnknownSync(Journal)(JSON.parse(record.migrated));
      if (record.original)
        await adapter.write(directory + "/journal.before-consolidation.json", record.original);
      await replace(journalPath, record.migrated);
    }
    const history = directory + "/history.json";
    if (await adapter.exists(history)) await adapter.remove(history);
    await adapter.remove(pendingPath);
  };
  const discardStale = async () => {
    if (await adapter.exists(pendingPath))
      await adapter.rename(
        pendingPath,
        directory + "/consolidation-stale-" + crypto.randomUUID() + ".json",
      );
  };
  return { loadDevice, stage, pending, install, discardStale };
}
