import { Effect } from "effect";

export class ActivityEvent {
  constructor(
    readonly message: string,
    readonly details = "",
  ) {}
}
export const reportProgress = (message: string, details = ""): Effect.Effect<void> =>
  Effect.logInfo(new ActivityEvent(message, details));

export interface ActivityEntry {
  readonly id: string;
  readonly time: number;
  readonly level: "info" | "success" | "warning" | "error";
  readonly message: string;
  readonly details?: string;
}
export function sanitizeActivity(message: string, secrets: readonly string[] = []): string {
  for (const secret of secrets) {
    if (secret) message = message.replaceAll(secret, "[redacted]");
  }
  return message
    .replace(/https?:\/\/[^\s<>"']+/gi, "[repository URL]")
    .replace(
      /(?:authorization|proxy-authorization|cookie|set-cookie)\s*[:=][^\r\n]*/gi,
      "[redacted header]",
    )
    .replace(/(?:bearer|basic)\s+[^\s,;]+/gi, "[redacted authorization]")
    .replace(
      /((?:password|passwd|token|secret|api[_-]?key|signature)\s*["']?\s*[:=]\s*)[^\s,;]+/gi,
      "$1[redacted]",
    )
    .replace(/(?:gh[pousr]_[a-zA-Z0-9_]+|github_pat_[a-zA-Z0-9_]+)/g, "[redacted token]")
    .slice(0, 1000);
}
export function activityFailure(error: unknown, secrets: readonly string[] = []): string {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  let cause = error;
  while (cause instanceof Error && !seen.has(cause) && messages.length < 4) {
    seen.add(cause);
    messages.push(sanitizeActivity(cause.message, secrets));
    cause = cause.cause;
  }
  return sanitizeActivity(
    messages.join(" — ") || "Unexpected sync failure. Local files were preserved.",
  );
}
