import { Effect, Schema } from "effect";
import type { App } from "obsidian";
import { AvailabilityJournal } from "../core/availability";
import { BlobId } from "../core/blobs";
import { explain, SyncError } from "../core/errors";
import { objectReference, verifyObject } from "../core/inventory";
import type { ConsolidationPreview } from "../git/consolidation";
import type { MigrationSnapshot } from "../maintenance/types";
import { ensureFolder } from "./storage";
import { installableJournal } from "./sync-decisions";

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
    const raw = JSON.parse(journal) as { blobs?: unknown; entries?: unknown };
    const files = new Map([["journal.json", new TextEncoder().encode(journal)]]);
    for (const id of Schema.decodeUnknownSync(Schema.Array(BlobId))(raw.blobs ?? []))
      files.set(
        "blobs/" + id,
        new Uint8Array(await adapter.readBinary(directory + "/blobs/" + id)),
      );
    for (const hash of deviceObjectHashes(raw)) {
      const path = "objects/" + hash;
      if (await adapter.exists(directory + "/" + path))
        files.set(path, new Uint8Array(await adapter.readBinary(directory + "/" + path)));
    }
    const historyPath = directory + "/history.json";
    if (await adapter.exists(historyPath))
      files.set("history.json", new TextEncoder().encode(await adapter.read(historyPath)));
    return { kind: "device", files };
  };

  const stageObject = async (path: string, bytes: Uint8Array) => {
    const reference = { bytes: bytes.length, hash: path.slice(8) };
    verifyObject(bytes, reference);
    const target = directory + "/" + path;
    if (await adapter.exists(target)) {
      const saved = new Uint8Array(await adapter.readBinary(target));
      if (objectReference(saved).hash === reference.hash) return;
    }
    await adapter.writeBinary(target, bytes.slice().buffer);
    verifyObject(new Uint8Array(await adapter.readBinary(target)), reference);
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
      await ensureFolder(adapter, directory + "/objects");
      for (const [path, bytes] of preview.device.files) {
        if (!/^objects\/[a-f0-9]{40}$/.test(path)) continue;
        await stageObject(path, bytes);
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
    if (!installableJournal(current, record.original, record.migrated))
      throw new Error("Local journal changed. Consolidation checkpoint preserved for recovery.");
    if (record.migrated) {
      Schema.decodeUnknownSync(AvailabilityJournal)(JSON.parse(record.migrated));
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
  return {
    loadDevice: () => operation(loadDevice),
    stage: (preview: ConsolidationPreview) => operation(() => stage(preview)),
    pending: () => operation(pending),
    install: () => operation(install),
    discardStale: () => operation(discardStale),
  };
}

const operation = <A>(action: () => Promise<A>) =>
  Effect.tryPromise({
    try: action,
    catch: (cause) => new SyncError({ message: explain(cause), cause }),
  });

function deviceObjectHashes(raw: { entries?: unknown }): Set<string> {
  if (raw.entries === undefined) return new Set();
  const journal = Schema.decodeUnknownSync(AvailabilityJournal)(raw);
  const references = journal.entries.flatMap((entry) => [
    entry.file.content,
    entry.file.state,
    entry.base?.content,
    entry.base?.state,
    entry.localContent,
    entry.baselineState,
  ]);
  const snapshots = [
    ...(journal.history.checkpoint ?? []),
    ...journal.history.entries.flatMap((entry) =>
      entry.changes.flatMap((change) => [
        change.baseline,
        change.local,
        change.incoming,
        change.result,
      ]),
    ),
  ];
  const all = references.concat(
    journal.intents.flatMap((intent) => [intent.before, intent.after, intent.baselineState]),
    snapshots.map((snapshot) => snapshot?.content),
  );
  return new Set(all.flatMap((reference) => (reference ? [reference.hash] : [])));
}
