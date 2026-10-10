import { Schema } from "effect";
import { useState, useSyncExternalStore } from "react";
import { establishConnection } from "../auth/connect";
import { matchingSavedCredentials } from "../auth/credential-decisions";
import type { Authentication } from "../auth/credentials";
import { CommitEmail } from "../core/config";
import { checkRemote } from "../git/remote";
import type { SetupActions } from "./setup-types";

function connectionInput(
  remoteInput: string,
  usernameInput: string,
  secret: string,
  saved: Authentication | null,
) {
  const remote = remoteInput.trim();
  checkRemote(remote);
  const username = usernameInput.trim();
  const stored = secret ? null : matchingSavedCredentials(remote, username, saved);
  if (!stored && Boolean(username) !== Boolean(secret))
    throw new Error(
      "Enter both a username and password/access token, or leave both empty for public access.",
    );
  return {
    remote,
    username,
    credentials: secret ? { type: "basic" as const, username, password: secret } : stored,
  };
}
export function useSetup(actions: SetupActions) {
  const snapshot = useSyncExternalStore(actions.store.subscribe, actions.store.getSnapshot);
  const initial = snapshot.config;
  const [state, setState] = useState(() => ({
    remote: initial.remote,
    username: initial.username,
    commitEmail: initial.commitEmail,
    secret: "",
    saved: actions.savedAuthentication(),
    busy: false,
    error: null as string | null,
  }));
  const patch = (next: Partial<typeof state>) => setState((current) => ({ ...current, ...next }));
  const updateRemote = (remote: string) => patch({ remote, error: null });
  const updateCredentials = (next: { username?: string; secret?: string; commitEmail?: string }) =>
    patch({ ...next, error: null });
  const connect = async () => {
    if (state.busy || snapshot.config.setupComplete) return;
    patch({ busy: true, error: null });
    try {
      const commitEmail = Schema.decodeUnknownSync(CommitEmail)(state.commitEmail.trim());
      const { remote, username, credentials } = connectionInput(
        state.remote,
        state.username,
        state.secret,
        state.saved,
      );
      const authentication: Authentication = { remote, credentials };
      await establishConnection(actions, authentication, username, commitEmail);
      patch({
        remote,
        username,
        commitEmail,
        secret: "",
        saved: authentication,
      });
    } catch (cause) {
      patch({ error: cause instanceof Error ? cause.message : "Could not connect. Try again." });
    } finally {
      patch({ busy: false });
    }
  };
  const disconnect = async () => {
    if (state.busy || !snapshot.config.setupComplete) return;
    patch({ busy: true, error: null });
    try {
      if (!(await actions.disconnect()))
        throw new Error(actions.store.getSnapshot().error ?? "Could not disconnect. Try again.");
    } catch (cause) {
      patch({ error: cause instanceof Error ? cause.message : "Could not disconnect. Try again." });
    } finally {
      patch({ busy: false });
    }
  };
  const savedCredentials = matchingSavedCredentials(
    state.remote.trim(),
    state.username.trim(),
    state.saved,
  );
  const savedCredentialMask = savedCredentials ? "*".repeat(savedCredentials.password.length) : "";
  return {
    state: {
      ...state,
      connected: snapshot.config.setupComplete,
    },
    savedCredentialMask,
    updateRemote,
    updateCredentials,
    connect,
    disconnect,
  };
}
