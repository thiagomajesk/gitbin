import { expect, it, vi } from "vitest";
import { drawSetupQr } from "../src/ui/setup-transfer-modal";
vi.mock("obsidian", () => ({ Modal: class {} }));

it("renders an opaque black-on-white QR with a white quiet zone in dark themes", () => {
  let pixels: Uint8ClampedArray = new Uint8ClampedArray();
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      createImageData: (width: number, height: number) => ({
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4),
      }),
      putImageData: (image: { data: Uint8ClampedArray }) => {
        pixels = image.data;
      },
    }),
  };
  drawSetupQr(canvas, "obsidian://gitbin-setup?data=test");
  expect(canvas.width).toBeGreaterThan(20);
  expect(canvas.width).toBe(canvas.height);
  expect([...pixels.subarray(0, 4)]).toEqual([255, 255, 255, 255]);
  const finder = (4 * canvas.width + 4) * 4;
  expect([...pixels.subarray(finder, finder + 4)]).toEqual([0, 0, 0, 255]);
  expect(pixels.filter((_byte, index) => index % 4 === 3).every((alpha) => alpha === 255)).toBe(
    true,
  );
});
