import { Primitive } from "@radix-ui/react-primitive";
import { useId, useState, useSyncExternalStore } from "react";
import type { SyncPreferences } from "../core/config";
import type { SetupActions } from "./setup-types";

export function SyncPreferencesForm({ actions }: { readonly actions: SetupActions }) {
  const id = useId();
  const { config } = useSyncExternalStore(actions.store.subscribe, actions.store.getSnapshot);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabled = saving || !config.setupComplete;
  const save = async (patch: Partial<SyncPreferences>) => {
    setSaving(true);
    setError(null);
    try {
      const saved = await actions.saveSyncPreferences({
        autoSync: config.autoSync,
        uploadDelay: config.uploadDelay,
        remoteCheckInterval: config.remoteCheckInterval,
        ...patch,
      });
      if (!saved) setError("Could not save automatic sync settings. Try again.");
    } catch {
      setError("Could not save automatic sync settings. Try again.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="setting-group" aria-labelledby={id + "-heading"}>
      <h3 id={id + "-heading"} className="setting-item-heading">
        Automatic sync
      </h3>
      <div className="setting-items gitbin:p-[var(--size-4-5)] gitbin:grid gitbin:gap-[var(--size-4-4)]">
        <div className="setting-item gitbin-sync-preference">
          <div className="setting-item-info">
            <div id={id + "-auto"} className="setting-item-name">
              Sync automatically
            </div>
            <div id={id + "-auto-description"} className="setting-item-description">
              Send and receive changes automatically while Obsidian is running.
            </div>
          </div>
          <div className="setting-item-control">
            <div className={"checkbox-container" + (config.autoSync ? " is-enabled" : "")}>
              <Primitive.input
                type="checkbox"
                role="switch"
                checked={config.autoSync}
                aria-labelledby={id + "-auto"}
                aria-describedby={id + "-auto-description"}
                disabled={disabled}
                onChange={(event) => void save({ autoSync: event.target.checked })}
              />
            </div>
          </div>
        </div>
        <div className="setting-item gitbin-sync-preference">
          <div className="setting-item-info">
            <label htmlFor={id + "-upload"} className="setting-item-name">
              Send local changes after
            </label>
            <div id={id + "-upload-description"} className="setting-item-description">
              Wait this long after your last edit before syncing.
            </div>
          </div>
          <div className="setting-item-control">
            <Primitive.select
              id={id + "-upload"}
              className="dropdown"
              aria-describedby={id + "-upload-description"}
              value={config.uploadDelay}
              disabled={disabled || !config.autoSync}
              onChange={(event) =>
                void save({
                  uploadDelay: Number(event.target.value) as SyncPreferences["uploadDelay"],
                })
              }
            >
              <option value={5000}>5 seconds</option>
              <option value={10000}>10 seconds</option>
              <option value={15000}>15 seconds</option>
              <option value={30000}>30 seconds</option>
              <option value={60000}>60 seconds</option>
            </Primitive.select>
          </div>
        </div>
        <div className="setting-item gitbin-sync-preference">
          <div className="setting-item-info">
            <label htmlFor={id + "-remote"} className="setting-item-name">
              Check for remote changes every
            </label>
            <div id={id + "-remote-description"} className="setting-item-description">
              How often to check the repository for changes from other devices.
            </div>
          </div>
          <div className="setting-item-control">
            <Primitive.select
              id={id + "-remote"}
              className="dropdown"
              aria-describedby={id + "-remote-description"}
              value={config.remoteCheckInterval}
              disabled={disabled || !config.autoSync}
              onChange={(event) =>
                void save({
                  remoteCheckInterval: Number(
                    event.target.value,
                  ) as SyncPreferences["remoteCheckInterval"],
                })
              }
            >
              <option value={60000}>1 minute</option>
              <option value={300000}>5 minutes</option>
              <option value={600000}>10 minutes</option>
              <option value={900000}>15 minutes</option>
            </Primitive.select>
          </div>
        </div>
        {error ? (
          <p role="alert" className="gitbin-error">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
