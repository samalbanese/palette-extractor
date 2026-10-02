import { expect, it } from "vitest";
import { prepare } from "./data";

it("keeps original sample indices for centroids and a separate upload order", () => {
  const data = prepare(
    {
      width: 3,
      height: 1,
      positions: new Uint16Array([0, 0, 1, 0, 2, 0]),
      colors: new Uint8Array([0, 0, 0, 255, 255, 255, 255, 0, 0]),
      groups: new Uint8Array([0, 0, 1]),
      boxes: new Uint8Array(),
      groupColors: [
        { r: 128, g: 128, b: 128 },
        { r: 255, g: 0, b: 0 },
      ],
    },
    "rgb",
  );
  expect(data.centroids).toEqual([
    [0, 0, 0],
    [127.5, -127.5, -127.5],
  ]);
  expect(data.counts).toEqual([2, 1]);
  expect([...data.order]).toEqual([0, 2, 1]);
});
