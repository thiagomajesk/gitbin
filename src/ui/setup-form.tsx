import { LoaderCircle, Plug, QrCode, Unplug } from "lucide-react";
import { useId } from "react";
import { TextField } from "./components";
import { Button, Form } from "./controls";
import { IconButton } from "./icon-button";
import type { SetupActions } from "./setup-types";
import { SyncPreferencesForm } from "./sync-preferences";
import { SyncStatus } from "./sync-status";
import { useSetup } from "./use-setup";
export function SetupForm({ actions }: { readonly actions: SetupActions }) {
  const formId = useId();
  const model = useSetup(actions);
  const { state, connect, disconnect } = model;
  return (
    <div className="gitbin-ui gitbin-settings-setup">
      <section className="setting-group">
        <div className="gitbin-settings-header">
          <h3 className="setting-item-heading">Repository</h3>
          <RepositoryActions state={state} actions={actions} formId={formId} />
        </div>
        <div className="setting-items">
          <Form
            id={formId}
            className="gitbin-repository-form gitbin:grid gitbin:gap-[var(--size-4-4)] gitbin:p-[var(--size-4-5)] gitbin:m-0"
            onSubmit={(event) => {
              event.preventDefault();
              void (state.connected ? disconnect() : connect());
            }}
          >
            <RepositoryFields {...model} />
          </Form>
        </div>
      </section>
      {state.error ? (
        <p className="gitbin-error" role="alert">
          {state.error}
        </p>
      ) : null}
      <SyncPreferencesForm actions={actions} />
      <SyncStatus actions={actions} />
      {state.connected ? <MaintenanceSection actions={actions} busy={state.busy} /> : null}
    </div>
  );
}

type SetupModel = ReturnType<typeof useSetup>;
function RepositoryActions({
  state,
  actions,
  formId,
}: {
  readonly state: SetupModel["state"];
  readonly actions: SetupActions;
  readonly formId: string;
}) {
  return (
    <div className="gitbin-header-actions">
      {state.connected ? (
        <IconButton
          label="Scan to sync"
          type="button"
          disabled={state.busy}
          onClick={() => actions.scanToSync()}
        >
          <QrCode aria-hidden="true" className="svg-icon" />
        </IconButton>
      ) : null}
      <IconButton
        label={state.connected ? "Disconnect" : "Connect"}
        type="submit"
        form={formId}
        disabled={state.busy}
        aria-busy={state.busy}
      >
        {state.busy ? (
          <LoaderCircle aria-hidden="true" className="svg-icon gitbin-spinner" />
        ) : state.connected ? (
          <Unplug aria-hidden="true" className="svg-icon" />
        ) : (
          <Plug aria-hidden="true" className="svg-icon" />
        )}
      </IconButton>
    </div>
  );
}
function RepositoryFields({
  state,
  savedCredentialMask,
  updateRemote,
  updateCredentials,
}: SetupModel) {
  return (
    <>
      {" "}
      <TextField
        label="Repository URL"
        type="url"
        hint="Enter the HTTPS clone URL of your repository."
        value={state.remote}
        placeholder="https://git.example.com/you/notes.git"
        disabled={state.busy || state.connected}
        onChange={updateRemote}
      />
      <TextField
        label="Username"
        hint="The account with write access to this repository. It can differ from the repository owner."
        value={state.username}
        disabled={state.busy || state.connected}
        onChange={(username) => updateCredentials({ username })}
      />
      <TextField
        label="Password or access token"
        type="password"
        hint={
          <>
            Many Git hosts require an access token instead of your account password.
            <br />
            Create one in your host’s settings with read and write access to this repository.
          </>
        }
        value={state.connected ? savedCredentialMask : state.secret}
        disabled={state.busy || state.connected}
        onChange={(secret) => updateCredentials({ secret })}
      />
      <TextField
        label="Author email (optional)"
        type="email"
        hint="The email that will be linked to the commit message as the author"
        value={state.commitEmail}
        disabled={state.busy || state.connected}
        onChange={(commitEmail) => updateCredentials({ commitEmail })}
      />
    </>
  );
}
function MaintenanceSection({
  actions,
  busy,
}: {
  readonly actions: SetupActions;
  readonly busy: boolean;
}) {
  return (
    <section className="setting-group">
      <div className="gitbin-settings-header">
        <h3 className="setting-item-heading">Maintenance</h3>
      </div>
      <div className="setting-items">
        <div className="setting-item">
          <div className="setting-item-info">
            <div className="setting-item-name">Consolidate repository</div>
            <div className="setting-item-description">
              Clear accumulated history to keep your repository lean and easier to maintain.
            </div>
          </div>
          <div className="setting-item-control">
            <Button type="button" disabled={busy} onClick={() => actions.consolidate()}>
              Consolidate
            </Button>
          </div>
        </div>
        <div className="setting-item">
          <div className="setting-item-info">
            <div className="setting-item-name">Reinitialize repository</div>
            <div className="setting-item-description">
              Repair damaged sync data so your vaults can sync again.
            </div>
          </div>
          <div className="setting-item-control">
            <Button type="button" disabled={busy} onClick={() => actions.reinitialize()}>
              Reinitialize
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
