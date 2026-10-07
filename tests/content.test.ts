import { expect, it } from "vitest";
import { contentFromBytes, contentBytes, binaryContent, textContent } from "../src/core/content";

it("keeps invalid UTF-8 and structured documents byte-exact and opaque", () => {
  for (const path of ["Drawing.canvas", "Table.base", "Data.json", "Image.png", "Document.pdf"])
    expect(contentFromBytes(path, new TextEncoder().encode('{"value":1}')).type).toBe("binary");
  const bytes = new Uint8Array([0xff, 0x80, 0x00, 0xc3]);
  expect(contentFromBytes("Bad.md", bytes)).toEqual(binaryContent(bytes));
  expect(contentBytes(contentFromBytes("Bad.md", bytes))).toEqual(bytes);
});
it("recognizes plaintext and preserves its UTF-8 BOM and Unicode", () => {
  const bytes = new TextEncoder().encode("\uFEFF# café 😀\r\n");
  expect(contentFromBytes("Guide.md", bytes)).toEqual(textContent("\uFEFF# café 😀\r\n"));
  expect(contentBytes(contentFromBytes("Guide.md", bytes))).toEqual(bytes);
});
