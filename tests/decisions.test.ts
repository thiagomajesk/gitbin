import { expect, it } from "vitest";
import {
  changeKind,
  connectionChanged,
  describeChange,
  migrationSequence,
  ownerAt,
  same,
} from "../src/core/decisions";

const base = { id: "id", path: "Note.md", text: "old", hash: "old", binary: false };
const local = { ...base, text: "local", hash: "local" };
const incoming = { ...base, text: "incoming", hash: "incoming" };
const identity = {
  remote: "repo",
  root: "vault",
  username: "user",
  commitEmail: "email",
  secretId: "secret",
};

it.each(["remote", "root", "username", "commitEmail", "secretId"] as const)(
  "detects a changed connection %s",
  (field) => {
    expect(connectionChanged(identity, { ...identity, [field]: "changed" })).toBe(true);
    expect(connectionChanged(identity, { ...identity })).toBe(false);
  },
);
it("compares snapshot content and location, including absence", () => {
  expect(same(null, null)).toBe(true);
  expect(same(base, null)).toBe(false);
  expect(same(null, base)).toBe(false);
  expect(same(base, { ...base, id: "different" })).toBe(true);
  expect(same(base, local)).toBe(false);
  expect(same(base, { ...base, path: null })).toBe(false);
});
it("classifies unknown, local, incoming, converged and divergent history", () => {
  expect(changeKind(base, local, incoming, false)).toBe("synced");
  expect(changeKind(base, local, base, true)).toBe("local");
  expect(changeKind(base, base, incoming, true)).toBe("incoming");
  expect(changeKind(base, incoming, incoming, true)).toBe("incoming");
  expect(changeKind(base, local, incoming, true)).toBe("combined");
});
it("omits unchanged and unknown deleted files while preserving comparison objects", () => {
  expect(describeChange(base, base, base, base, true)).toBeNull();
  expect(describeChange(null, null, null, { ...base, path: null }, false)).toBeNull();
  const change = describeChange(base, local, incoming, local, true);
  expect(change?.kind).toBe("combined");
  expect(change?.baseline).toBe(base);
  expect(change?.local).toBe(local);
  expect(change?.incoming).toBe(incoming);
  expect(change?.result).toBe(local);
  expect(describeChange(null, null, base, base, false)?.kind).toBe("synced");
});
it.each([
  [[], ["a", "b"], "supported"],
  [["a"], ["a", "b"], "supported"],
  [["a", "b"], ["a", "b"], "supported"],
  [["b", "a"], ["a", "b"], "invalid"],
  [["a", "a"], ["a", "b"], "invalid"],
  [["a", "b", "a"], ["a", "b"], "invalid"],
  [["a", "c"], ["a", "b"], "newer"],
  [[], [], "supported"],
] as const)("classifies migration sequence %j against %j as %s", (applied, expected, result) => {
  expect(migrationSequence(applied, expected)).toBe(result);
});
it("finds the first collision across exact, ancestor and descendant paths", () => {
  expect(ownerAt(["notes", "notes/a"], "notes/a")).toBe("notes");
  expect(ownerAt(["notes/a"], "notes")).toBe("notes/a");
  expect(ownerAt(["notes/a"], "notes/a")).toBe("notes/a");
  expect(ownerAt(["notes"], "notes2")).toBeUndefined();
  expect(ownerAt(["📁/é"], "📁")).toBe("📁/é");
  expect(ownerAt(["\ud800/file"], "\ud800")).toBe("\ud800/file");
  expect(ownerAt([], "")).toBeUndefined();
});
