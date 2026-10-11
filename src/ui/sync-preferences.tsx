import { Primitive } from "@radix-ui/react-primitive";
import { useId, useState, useSyncExternalStore } from "react";
import { downloadLimit, type SyncPreferences } from "../core/config";
import type { SetupActions } from "./setup-types";

export function SyncPreferencesForm({ actions }: { readonly actions: SetupActions }) {
  const id = useId();
  const { config } = useSyncExternalStore(actions.store.subscribe, actions.store.getSnapshot);
  const { saving, error, save } = usePreferenceSaving(actions, config);
  const disabled = saving || !config.setupComplete;
  return (
    <section className="setting-group" aria-labelledby={id + "-heading"}>
      <h3 id={id + "-heading"} className="setting-item-heading">
        Sync and downloads
      </h3>
      <div className="setting-items gitbin:p-[var(--size-4-5)] gitbin:grid gitbin:gap-[var(--size-4-4)]">
        <PreferenceToggle
          id={id + "-auto"}
          label="Sync automatically"
          description="Sync file changes automatically across devices"
          checked={config.autoSync}
          disabled={disabled}
          onChange={(checked) => void save({ autoSync: checked })}
        />
        <DownloadPreferences id={id} config={config} disabled={saving} save={save} />
        <SyncDelays id={id} config={config} disabled={disabled} save={save} />
        {error ? (
          <p role="alert" className="gitbin-error">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function PreferenceToggle({
  id,
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <div className="setting-item gitbin-sync-preference">
      <div className="setting-item-info">
        <div id={id} className="setting-item-name">
          {label}
        </div>
        <div id={id + "-description"} className="setting-item-description">
          {description}
        </div>
      </div>
      <div className="setting-item-control">
        <label className={"checkbox-container" + (checked ? " is-enabled" : "")}>
          <Primitive.input
            type="checkbox"
            role="switch"
            checked={checked}
            aria-labelledby={id}
            aria-describedby={id + "-description"}
            disabled={disabled}
            onChange={(event) => onChange(event.target.checked)}
          />
        </label>
      </div>
    </div>
  );
}
function DelayPreference<T extends number | string>({
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
  readonly value: T;
  readonly disabled: boolean;
  readonly options: readonly (readonly [T, string])[];
  readonly onChange: (value: T) => void;
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
          onChange={(event) => {
            const selected = options.find(([value]) => String(value) === event.target.value);
            if (selected) onChange(selected[0]);
          }}
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

function DownloadPreferences({
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
    <>
      <PreferenceToggle
        id={id + "-downloads"}
        label="On-demand downloads"
        description="Download files when you open them. Helpful for saving storage space"
        checked={config.downloadMode === "on-demand"}
        disabled={disabled}
        onChange={(checked) => void save({ downloadMode: checked ? "on-demand" : "all" })}
      />
      <StorageLimit
        id={id + "-storage"}
        value={config.storageMegabytes}
        disabled={disabled || config.downloadMode !== "on-demand"}
        save={save}
      />
      <DownloadLimit id={id + "-max-download"} config={config} disabled={disabled} save={save} />
    </>
  );
}
function StorageLimit({
  id,
  value,
  disabled,
  save,
}: {
  readonly id: string;
  readonly value: SyncPreferences["storageMegabytes"];
  readonly disabled: boolean;
  readonly save: (patch: Partial<SyncPreferences>) => Promise<void>;
}) {
  return (
    <DelayPreference
      id={id}
      label="Local storage limit"
      description="Limit the storage used to sync this vault"
      value={value}
      disabled={disabled}
      options={[
        [50, "50 MB"],
        [100, "100 MB"],
        [500, "500 MB"],
        [1024, "1024 MB"],
        ["unlimited", "Unlimited"],
      ]}
      onChange={(storageMegabytes) => void save({ storageMegabytes })}
    />
  );
}

function DownloadLimit({
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
  const cap =
    config.downloadMode === "all" || config.storageMegabytes === "unlimited"
      ? Infinity
      : config.storageMegabytes;
  const values = [
    ...new Set([
      5,
      10,
      25,
      50,
      100,
      ...(config.maxDownloadMegabytes === "unlimited" ? [] : [config.maxDownloadMegabytes]),
    ]),
  ]
    .sort((a, b) => a - b)
    .filter((value) => value <= cap);
  const options: [number | "unlimited", string][] = values.map((value) => [value, `${value} MB`]);
  if (cap === Infinity) options.push(["unlimited", "Unlimited"]);
  return (
    <DelayPreference
      id={id}
      label="Max download size"
      description="Maximum size of an individual note or attachment to download."
      value={config.maxDownloadMegabytes}
      disabled={disabled}
      options={options}
      onChange={(maxDownloadMegabytes) => void save({ maxDownloadMegabytes })}
    />
  );
}

function usePreferenceSaving(actions: SetupActions, config: SyncPreferences) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (patch: Partial<SyncPreferences>) => {
    setSaving(true);
    setError(null);
    try {
      const next = {
        autoSync: config.autoSync,
        uploadDelay: config.uploadDelay,
        remoteCheckInterval: config.remoteCheckInterval,
        storageMegabytes: config.storageMegabytes,
        downloadMode: config.downloadMode,
        maxDownloadMegabytes: config.maxDownloadMegabytes,
        ...patch,
      };
      const saved = await actions.saveSyncPreferences({
        ...next,
        maxDownloadMegabytes: downloadLimit(next),
      });
      if (!saved) setError("Could not save sync settings. Try again.");
    } catch {
      setError("Could not save sync settings. Try again.");
    } finally {
      setSaving(false);
    }
  };
  return { saving, error, save };
}

function SyncDelays({
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
    <>
      <DelayPreference
        id={id + "-upload"}
        label="Send local changes after"
        description="Choose how long to wait after an edit before syncing"
        value={config.uploadDelay}
        disabled={disabled || !config.autoSync}
        options={[
          [5000, "5 seconds"],
          [10000, "10 seconds"],
          [15000, "15 seconds"],
          [30000, "30 seconds"],
          [60000, "60 seconds"],
        ]}
        onChange={(value) => void save({ uploadDelay: value })}
      />
      <DelayPreference
        id={id + "-remote"}
        label="Check for remote changes every"
        description="Choose how often to check the repository for changes"
        value={config.remoteCheckInterval}
        disabled={disabled || !config.autoSync}
        options={[
          [60000, "1 minute"],
          [300000, "5 minutes"],
          [600000, "10 minutes"],
          [900000, "15 minutes"],
        ]}
        onChange={(value) => void save({ remoteCheckInterval: value })}
      />
    </>
  );
}
