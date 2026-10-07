import { Platform, type SecretStorage } from "obsidian";
import type { Config } from "../core/config";

export function commitAuthor(config: Pick<Config, "username" | "commitEmail">, device: string) {
  const name = config.username.trim() || "Anonymous";
  return { name, email: config.commitEmail || `${name.replace(/[\s<>@]/g, "-")}@${device}` };
}

export async function deviceName(
  storage: Pick<SecretStorage, "getSecret" | "setSecret">,
): Promise<string> {
  if (Platform.isDesktopApp) {
    const { hostname } = require("node:os") as typeof import("node:os");
    return hostname();
  }
  const key = "gitbin-device-id";
  let id = storage.getSecret(key);
  if (!id) {
    id = crypto.randomUUID();
    storage.setSecret(key, id);
  }
  return `${Platform.isIosApp ? "iOS" : "Android"}-${id.slice(0, 8)}`;
}
