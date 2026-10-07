import { Effect, Schema } from "effect";
import { attempt, io, SyncError } from "../core/errors";
import { decodeSetup, type SyncSetupPayload } from "./setup-transfer";

export const setupCodeRefreshMs = 30000;
const lifetimeMs = 120000;
const maxUriLength = 2000;
const context = new TextEncoder().encode("gitbin-setup:1");
const Envelope = Schema.Struct({
  expiresAt: Schema.Number.check(Schema.isInt()),
  setup: Schema.Unknown,
});
export type SealedSetup = Uint8Array<ArrayBuffer>;

function randomPin(): string {
  const number = new Uint32Array(1);
  do {
    crypto.getRandomValues(number);
  } while ((number[0] ?? 0) >= 4294000000);
  return ((number[0] ?? 0) % 1000000).toString().padStart(6, "0");
}

async function key(pin: string, salt: SealedSetup): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 600000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export const createSetupCode = Effect.fn("setup.encrypt")(function* (input: SyncSetupPayload) {
  const setup = yield* attempt("Cannot share this repository configuration.", () =>
    decodeSetup(input),
  );
  const pin = randomPin();
  const expiresAt = Date.now() + lifetimeMs;
  const text = JSON.stringify({ expiresAt, setup });
  if (text.length > 1400)
    return yield* new SyncError({
      message: "This configuration is too large for one QR code. Enter it in settings instead.",
    });
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = yield* io("Cannot encrypt this setup code.", async () =>
    crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: context },
      await key(pin, salt),
      new TextEncoder().encode(text),
    ),
  );
  const bytes = new Uint8Array(29 + ciphertext.byteLength);
  bytes[0] = 1;
  bytes.set(salt, 1);
  bytes.set(iv, 17);
  bytes.set(new Uint8Array(ciphertext), 29);
  const data = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  const uri = `obsidian://gitbin-setup?vault=${encodeURIComponent(setup.root)}&data=${data}`;
  if (uri.length > maxUriLength)
    return yield* new SyncError({
      message: "This configuration is too large for one QR code. Enter it in settings instead.",
    });
  return { uri, pin, expiresAt };
});

export function readSetupCode(data: string): SealedSetup {
  try {
    if (!data || data.length > maxUriLength || !/^[A-Za-z0-9_-]+$/.test(data)) throw new Error();
    const bytes = Uint8Array.from(atob(data.replaceAll("-", "+").replaceAll("_", "/")), (char) =>
      char.charCodeAt(0),
    );
    if (bytes.length < 46 || bytes[0] !== 1) throw new Error();
    return bytes;
  } catch {
    throw new Error("Invalid or unsupported setup code. Generate a new QR code on your desktop.");
  }
}

export const unlockSetupCode = Effect.fn("setup.decrypt")(function* (
  bytes: SealedSetup,
  pin: string,
) {
  if (!/^\d{6}$/.test(pin))
    return yield* new SyncError({ message: "Enter the six-digit code shown on your desktop." });
  const clear = yield* io("Incorrect code or damaged QR. Check the code or scan again.", async () =>
    crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(17, 29), additionalData: context },
      await key(pin, bytes.slice(1, 17)),
      bytes.slice(29),
    ),
  );
  const envelope = yield* attempt("Invalid or unsupported setup code.", () =>
    Schema.decodeUnknownSync(Envelope, { onExcessProperty: "error" })(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(clear)),
    ),
  );
  const now = Date.now();
  if (envelope.expiresAt <= now || envelope.expiresAt > now + lifetimeMs)
    return yield* new SyncError({
      message: "This code has expired. Scan the current QR on your desktop.",
    });
  return yield* attempt("Invalid or unsupported setup code.", () => decodeSetup(envelope.setup));
});
