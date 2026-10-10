import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { FileContent } from "./content-values";
import { equalContent as equalValues } from "./content-values";

export { type FileContent, textContent } from "./content-values";

import { textContent } from "./content-values";

export function encodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32768)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
}
export function decodeBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
export const binaryContent = (bytes: Uint8Array): FileContent => ({
  type: "binary",
  value: encodeBytes(bytes),
});
export const contentBytes = (content: FileContent): Uint8Array =>
  content.type === "binary" ? decodeBytes(content.value) : new TextEncoder().encode(content.value);
export const contentEqual = (
  left: FileContent | null | undefined,
  right: FileContent | null | undefined,
): boolean => equalValues(left ?? null, right ?? null);
export const contentHash = (content: FileContent): string =>
  bytesToHex(sha256(contentBytes(content)));

// Unknown formats and structured documents use atomic replacements, preserving valid bytes.
const textExtensions = new Set([
  "md",
  "markdown",
  "txt",
  "text",
  "log",
  "csv",
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "css",
  "scss",
  "html",
  "htm",
  "ex",
  "exs",
  "py",
  "rb",
  "rs",
  "go",
  "c",
  "h",
  "cpp",
  "hpp",
  "java",
  "kt",
  "swift",
  "sh",
  "sql",
  "tex",
]);
function textPath(path: string): boolean {
  return textExtensions.has(path.split(".").at(-1)?.toLowerCase() ?? "");
}
export function rawContentKind(path: string, bytes: Uint8Array): "text" | "binary" {
  if (!textPath(path) || bytes.includes(0)) return "binary";
  try {
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    return "text";
  } catch {
    return "binary";
  }
}
export function contentFromBytes(path: string, bytes: Uint8Array): FileContent {
  const extension = path.split(".").at(-1)?.toLowerCase() ?? "";
  if (textExtensions.has(extension) && !bytes.includes(0)) {
    try {
      // Keep a UTF-8 BOM if present so reading and writing remain byte-identical.
      return textContent(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
    } catch {
      // Invalid UTF-8 is an opaque file, never lossy replacement text.
    }
  }
  return binaryContent(bytes);
}
