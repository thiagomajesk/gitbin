import { describe, expect, it } from "vitest";
import { readCredentials, scopedCredentials, storeCredentials } from "../src/auth/credentials";

describe("Git authentication", () => {
  it("scopes credentials to the exact repository and never sends them to another origin", async () => {
    const credentials = { type: "basic" as const, username: "user", password: "secret" };
    const provider = scopedCredentials("https://git.example.com/notes.git", credentials);
    expect(await provider("https://git.example.com/notes.git")).toEqual(credentials);
    expect(await provider("https://other.example/notes.git")).toBeNull();
    expect(await provider("https://git.example.com/other.git")).toBeNull();
  });
  it("round-trips current credentials and rejects unsupported formats", () => {
    const credentials = { type: "basic" as const, username: "user", password: "secret" };
    expect(readCredentials(storeCredentials(credentials))).toEqual(credentials);
    expect(() => readCredentials('gitbin-auth-v1:{"type":"bearer","token":"secret"}')).toThrow();
    expect(() => readCredentials("legacy-secret")).toThrow("Unsupported Gitbin credential format");
    expect(readCredentials(null)).toBeNull();
  });
});
