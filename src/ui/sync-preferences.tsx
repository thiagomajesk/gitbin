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
        <AutoSyncToggle id={id} config={config} disabled={disabled} save={save} />
        <DelayPreference
          id={id + "-upload"}
          label="Send local changes after"
          description="Wait this long after your last edit before syncing."
          value={config.uploadDelay}
          disabled={disabled || !config.autoSync}
          options={[
            [5000, "5 seconds"],
            [10000, "10 seconds"],
            [15000, "15 seconds"],
            [30000, "30 seconds"],
            [60000, "60 seconds"],
          ]}
          onChange={(value) => void save({ uploadDelay: value as SyncPreferences["uploadDelay"] })}
        />
        <DelayPreference
          id={id + "-remote"}
          label="Check for remote changes every"
          description="How often to check the repository for changes from other devices."
          value={config.remoteCheckInterval}
          disabled={disabled || !config.autoSync}
          options={[
            [60000, "1 minute"],
            [300000, "5 minutes"],
            [600000, "10 minutes"],
            [900000, "15 minutes"],
          ]}
          onChange={(value) =>
            void save({ remoteCheckInterval: value as SyncPreferences["remoteCheckInterval"] })
          }
        />
        {error ? (
          <p role="alert" className="gitbin-error">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function AutoSyncToggle({
  id,
  config,
  disabled,
  save,
}: {
  readonly id: string;
  readonly config: SyncPreferences;
  readonly disabled: boolean;
  readonly save: (patch: Partial<SyncPreferences>) => Promise<void>;
}) {
  return (
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
  );
}
function DelayPreference({
  id,
  label,
  description,
  value,
  disabled,
  options,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly value: number;
  readonly disabled: boolean;
  readonly options: readonly (readonly [number, string])[];
  readonly onChange: (value: number) => void;
}) {
  return (
    <div className="setting-item gitbin-sync-preference gitbin-sync-delay">
      <div className="setting-item-info">
        <label htmlFor={id} className="setting-item-name">
          {label}
        </label>
        <div id={id + "-description"} className="setting-item-description">
          {description}
        </div>
      </div>
      <div className="setting-item-control">
        <Primitive.select
          id={id}
          className="dropdown"
          aria-describedby={id + "-description"}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
        >
          {options.map(([number, text]) => (
            <option key={number} value={number}>
              {text}
            </option>
          ))}
        </Primitive.select>
      </div>
    </div>
  );
}
