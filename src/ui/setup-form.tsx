import { LoaderCircle, Plug, Unplug, QrCode } from "lucide-react";
import { useId } from "react";
import { Form } from "./controls";
import { IconButton } from "./icon-button";
import { TextField } from "./components";
import type { SetupActions } from "./setup-types";
import { useSetup } from "./use-setup";
import { SyncPreferencesForm } from "./sync-preferences";
import { SyncStatus } from "./sync-status";
export function SetupForm({ actions }: { readonly actions: SetupActions }) {
  const formId = useId();
  const { state, savedCredentialMask, updateRemote, updateCredentials, connect, disconnect } =
    useSetup(actions);
  return (
    <div className="gitbin-ui gitbin-settings-setup">
      <section className="setting-group">
        <div className="gitbin-settings-header">
          <h3 className="setting-item-heading">Repository</h3>
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
    </div>
  );
}
