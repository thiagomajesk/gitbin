import { Effect } from "effect";
import { expect, it, vi } from "vitest";
import { createSetupCode, readSetupCode, unlockSetupCode } from "../src/auth/setup-code";
import { defaults } from "../src/core/config";
import { exportSetup } from "../src/auth/setup-transfer";

const payload = exportSetup(
  {
    ...defaults(),
    setupComplete: true,
    root: "My vault",
    remote: "https://github.com/you/vault.git",
  },
  {
    remote: "https://github.com/you/vault.git",
    credentials: { type: "basic", username: "you", password: "token-秘密" },
  },
);

it("encrypts credentials with a six-digit code that is never embedded in the URI", async () => {
  const code = await Effect.runPromise(createSetupCode(payload));
  expect(code.pin).toMatch(/^\d{6}$/);
  const uri = new URL(code.uri);
  expect(uri.searchParams.get("vault")).toBe(payload.root);
  expect([...uri.searchParams.keys()]).toEqual(["vault", "data"]);
  const data = uri.searchParams.get("data") ?? "";
  expect(data).toMatch(/^[A-Za-z0-9_-]+$/);
  expect(Buffer.from(data, "base64url").toString()).not.toContain("token-秘密");
  expect(await Effect.runPromise(unlockSetupCode(readSetupCode(data), code.pin))).toEqual(payload);
  await expect(
    Effect.runPromise(
      unlockSetupCode(readSetupCode(data), code.pin === "000000" ? "111111" : "000000"),
    ),
  ).rejects.toThrow("Incorrect code");
  const corrupted = readSetupCode(data);
  corrupted[corrupted.length - 1] = (corrupted[corrupted.length - 1] ?? 0) ^ 1;
  await expect(Effect.runPromise(unlockSetupCode(corrupted, code.pin))).rejects.toThrow(
    "Incorrect code",
  );
});

it("makes a fresh encrypted QR on each refresh and rejects expired captures", async () => {
  const first = await Effect.runPromise(createSetupCode(payload));
  const second = await Effect.runPromise(createSetupCode(payload));
  expect(first.uri).not.toBe(second.uri);
  const data = new URL(first.uri).searchParams.get("data") ?? "";
  const clock = vi.spyOn(Date, "now").mockReturnValue(first.expiresAt);
  try {
    await expect(
      Effect.runPromise(unlockSetupCode(readSetupCode(data), first.pin)),
    ).rejects.toThrow("expired");
  } finally {
    clock.mockRestore();
  }
});

it.each(["", "not base64!", "a".repeat(2001), Buffer.from('{"version":1}').toString("base64url")])(
  "rejects malformed and plaintext QR data without a compatibility path",
  (data) => {
    expect(() => readSetupCode(data)).toThrow("Invalid or unsupported setup code");
  },
);

it("rejects oversized exports before making a QR", async () => {
  await expect(
    Effect.runPromise(
      createSetupCode({
        ...payload,
        credentials: { type: "basic", username: "you", password: "x".repeat(2000) },
      }),
    ),
  ).rejects.toThrow("too large");
});
